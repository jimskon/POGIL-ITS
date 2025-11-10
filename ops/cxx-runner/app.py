from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Union
import os
import tempfile
import shlex
import subprocess
import asyncio
import uuid
import shutil
import time
import json
import redis.asyncio as redis

app = FastAPI(title="C++20 Runner", version="1.5")

# --- configuration ---
SESSION_TTL_SEC = 600
WALL_LIMIT_SEC = 8
IDLE_LIMIT_SEC = 4

r = redis.Redis(host="redis", port=6379, decode_responses=True)


def _session_key(sid: str) -> str:
    return f"cxx:sess:{sid}"


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------- models & helpers ----------

class RunReq(BaseModel):
    code: str = Field(..., min_length=1, max_length=20000)
    # Either { "name": "content", ... } or [ { "name", "content" }, ... ]
    files: Optional[Union[Dict[str, str], List[Dict[str, str]]]] = None


class RunResp(BaseModel):
    ok: bool
    compile_stderr: str
    stdout: str
    stderr: str
    exit_code: int
    files: Dict[str, str] = {}


def _run_cmd(cmd: str, cwd: str, timeout: int):
    try:
        p = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=True,
        )
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as e:
        return 124, (e.stdout or ""), (e.stderr or "") + "\n[TIMEOUT]\n"


def _materialize_files(td: str, files) -> List[str]:
    """
    Write provided files into td.
    Returns list of source file paths to compile (if any).
    """
    if not files:
        return []

    if isinstance(files, dict):
        items = list(files.items())
    else:
        items = [
            ((f.get("name") or "").strip(), f.get("content", ""))
            for f in files
            if (f.get("name") or "").strip()
        ]

    src_paths: List[str] = []

    for name, content in items:
        safe = os.path.basename(name)
        if not safe:
            continue
        path = os.path.join(td, safe)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content or "")
        if safe.endswith((".cpp", ".cc", ".cxx", ".c")):
            src_paths.append(path)

    return src_paths


def _collect_text_files(td: str, ignore: Optional[List[str]] = None) -> Dict[str, str]:
    """
    Collect small readable text files from td, excluding ignore.
    Used to surface outputs like out.txt back to the frontend.
    """
    ignore = set(ignore or [])
    out: Dict[str, str] = {}

    try:
        names = os.listdir(td)
    except OSError:
        return out

    for name in names:
        if name in ignore:
            continue

        path = os.path.join(td, name)
        if not os.path.isfile(path):
            continue

        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        if size > 64 * 1024:
            # skip large files
            continue

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = f.read()
        except (UnicodeDecodeError, OSError):
            continue

        out[name] = data

    return out


# ---------- non-interactive run (kept for compatibility) ----------

@app.post("/run", response_model=RunResp)
def run_cpp(req: RunReq):
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "main.cpp")
        bin_path = os.path.join(td, "a.out")

        with open(src, "w", encoding="utf-8") as f:
            f.write(req.code)

        extra_srcs = _materialize_files(td, req.files)

        compile_cmd = (
            "g++ -std=c++20 -O2 -pipe -static-libstdc++ -static-libgcc -s "
            f"-o {shlex.quote(bin_path)} {shlex.quote(src)}"
        )
        if extra_srcs:
            compile_cmd += " " + " ".join(shlex.quote(p) for p in extra_srcs)

        rc_c, _out_c, err_c = _run_cmd(compile_cmd, td, timeout=8)
        if rc_c != 0:
            return RunResp(
                ok=False,
                compile_stderr=err_c,
                stdout="",
                stderr="",
                exit_code=rc_c,
                files={},
            )

        run_cmdline = (
            "bash -lc "
            f"'ulimit -t 2 -c 0 -v 262144 -f 4096; timeout 2s {shlex.quote(bin_path)}'"
        )
        rc_r, out_r, err_r = _run_cmd(run_cmdline, td, timeout=3)

        files_out = _collect_text_files(td, ignore=["main.cpp", "a.out"])

        return RunResp(
            ok=True,
            compile_stderr=err_c or "",
            stdout=out_r,
            stderr=err_r,
            exit_code=rc_r,
            files=files_out,
        )


# ---------- interactive session endpoints ----------

class NewSessionReq(RunReq):
    pass


@app.post("/session/new")
async def session_new(req: NewSessionReq):
    """
    Create a new interactive session:
    - writes main.cpp
    - materializes any provided files
    - compiles
    - stores tmpdir/exe in Redis keyed by sessionId
    """
    td = tempfile.mkdtemp()
    src = os.path.join(td, "main.cpp")
    exe = os.path.join(td, "a.out")

    with open(src, "w", encoding="utf-8") as f:
        f.write(req.code)

    extra_srcs = _materialize_files(td, req.files)

    compile_cmd = [
        "g++", "-std=c++20", "-O2", "-pipe",
        "-static-libstdc++", "-static-libgcc", "-s",
        src, "-o", exe,
    ] + extra_srcs

    proc = await asyncio.create_subprocess_exec(
        *compile_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=td,
    )
    _out, err = await proc.communicate()

    if proc.returncode != 0:
        shutil.rmtree(td, ignore_errors=True)
        return {"ok": False, "compile_error": err.decode(errors="ignore")}

    sid = str(uuid.uuid4())
    await r.hset(_session_key(sid), mapping={
        "tmpdir": td,
        "exe": exe,
        "created_at": str(time.time()),
    })
    await r.expire(_session_key(sid), SESSION_TTL_SEC)

    return {"ok": True, "sessionId": sid}


@app.websocket("/session/ws/{sid}")
async def session_ws(ws: WebSocket, sid: str):
    """
    Interactive execution:
    - runs the compiled binary
    - streams stdout/stderr
    - forwards terminal input to stdin
    - enforces wall/idle limits
    - on exit, sends [FILES]{json} with any small text files
    """
    await ws.accept()

    key = _session_key(sid)
    meta = await r.hgetall(key)
    if not meta:
        await ws.send_text("Session not found\n")
        await ws.close()
        return

    tmpdir = meta["tmpdir"]
    exe = meta["exe"]

    try:
        proc = await asyncio.create_subprocess_exec(
            "bash",
            "-lc",
            "ulimit -t 4 -c 0 -v 262144 -f 4096; "
            f"stdbuf -oL -eL {shlex.quote(exe)}",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=tmpdir,
        )
    except Exception as e:
        await ws.send_text(f"Failed to start: {e}\n")
        await ws.close()
        await _kill_and_cleanup(key, tmpdir)
        return

    started_at = time.monotonic()
    last_output = time.monotonic()

    async def pump_stdout():
        nonlocal last_output
        try:
            while True:
                chunk = await proc.stdout.read(1024)
                if not chunk:
                    break
                last_output = time.monotonic()
                await ws.send_text(chunk.decode(errors="ignore"))
        except Exception:
            # Do not crash the session for stdout issues
            pass

    async def watchdog():
        try:
            while True:
                await asyncio.sleep(0.5)
                now = time.monotonic()
                if proc.returncode is not None:
                    break
                if now - started_at > WALL_LIMIT_SEC:
                    await ws.send_text("\n[WALL TIME EXCEEDED]\n")
                    proc.kill()
                    break
                if now - last_output > IDLE_LIMIT_SEC:
                    await ws.send_text("\n[IDLE TIME EXCEEDED]\n")
                    proc.kill()
                    break
        except Exception:
            pass

    t_pump = asyncio.create_task(pump_stdout())
    t_watch = asyncio.create_task(watchdog())

    try:
        while True:
            # If the program has already exited, stop reading input
            if proc.returncode is not None:
                break

            try:
                # Short timeout so we can re-check proc.returncode regularly
                data = await asyncio.wait_for(ws.receive_text(), timeout=0.2)
            except asyncio.TimeoutError:
                continue
            except WebSocketDisconnect:
                break

            if proc.returncode is not None:
                break

            try:
                proc.stdin.write(data.encode())
                await proc.stdin.drain()
            except Exception:
                break
    finally:
        # Ensure the process is stopped
        try:
            if proc.returncode is None:
                proc.kill()
        except Exception:
            pass

        await asyncio.gather(t_pump, t_watch, return_exceptions=True)

        # Send back any small text files before cleanup
        try:
            files_out = _collect_text_files(tmpdir, ignore=["main.cpp", "a.out"])
            if files_out:
                await ws.send_text("[FILES]" + json.dumps(files_out))
        except Exception:
            pass

        try:
            await ws.close()
        except Exception:
            pass

        await _kill_and_cleanup(key, tmpdir)


async def _kill_and_cleanup(key: str, tmpdir: str):
    try:
        await r.delete(key)
    except Exception:
        pass
    try:
        shutil.rmtree(tmpdir, ignore_errors=True)
    except Exception:
        pass
