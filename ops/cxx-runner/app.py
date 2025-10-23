# /srv/app.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
import os, tempfile, asyncio, uuid, shutil, time, shlex, subprocess
import redis.asyncio as redis

app = FastAPI(title="C++20 Runner", version="1.3")

# ---- health ----
@app.get("/health")
def health():
    return {"status": "ok"}

# ---- non-interactive /run ----
class RunReq(BaseModel):
    code: str = Field(..., min_length=1, max_length=20000)

class RunResp(BaseModel):
    ok: bool
    compile_stderr: str
    stdout: str
    stderr: str
    exit_code: int

def _run_cmd(cmd: str, cwd: str, timeout: int):
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, shell=True)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as e:
        return 124, e.stdout or "", (e.stderr or "") + "\n[TIMEOUT]\n"

@app.post("/run", response_model=RunResp)
def run_cpp(req: RunReq):
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "main.cpp")
        bin_path = os.path.join(td, "a.out")
        with open(src, "w") as f:
            f.write(req.code)

        compile_cmd = (
            f"g++ -std=c++20 -O2 -pipe -static-libstdc++ -static-libgcc -s "
            f"-o {shlex.quote(bin_path)} {shlex.quote(src)}"
        )
        rc_c, _out_c, err_c = _run_cmd(compile_cmd, td, timeout=8)
        if rc_c != 0:
            return RunResp(ok=False, compile_stderr=err_c, stdout="", stderr="", exit_code=rc_c)

        run_cmdline = f"bash -lc 'ulimit -t 2 -c 0 -v 262144 -f 4096; timeout 2s {shlex.quote(bin_path)}'"
        rc_r, out_r, err_r = _run_cmd(run_cmdline, td, timeout=3)

        return RunResp(ok=True, compile_stderr=err_c or "", stdout=out_r, stderr=err_r, exit_code=rc_r)

# ---- interactive (Redis; pipes) ----
REDIS_URL       = os.getenv("REDIS_URL", "redis://redis:6379/0")
SESSION_TTL_SEC = int(os.getenv("SESSION_TTL_SEC", "900"))
WALL_LIMIT_SEC  = int(os.getenv("WALL_LIMIT_SEC", "20"))
IDLE_LIMIT_SEC  = int(os.getenv("IDLE_LIMIT_SEC", "10"))
MAX_CODE_BYTES  = int(os.getenv("MAX_CODE_BYTES", "20000"))

r = redis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)

class NewSessionReq(BaseModel):
    code: str = Field(..., min_length=1, max_length=MAX_CODE_BYTES)

def _session_key(sid: str) -> str:
    return f"cxx:sess:{sid}"

@app.post("/session/new")
async def session_new(req: NewSessionReq):
    tmpdir = tempfile.mkdtemp()
    src = os.path.join(tmpdir, "main.cpp")
    exe = os.path.join(tmpdir, "a.out")
    with open(src, "w") as f:
        f.write(req.code)

    proc = await asyncio.create_subprocess_exec(
        "g++", "-std=c++20", "-O2", "-pipe",
        "-static-libstdc++", "-static-libgcc", "-s",
        src, "-o", exe,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=tmpdir,
    )
    _out, err = await proc.communicate()
    if proc.returncode != 0:
        shutil.rmtree(tmpdir, ignore_errors=True)
        return {"ok": False, "compile_error": err.decode(errors="ignore")}

    sid = str(uuid.uuid4())
    await r.hset(_session_key(sid), mapping={"tmpdir": tmpdir, "exe": exe, "created_at": str(time.time())})
    await r.expire(_session_key(sid), SESSION_TTL_SEC)
    return {"ok": True, "sessionId": sid}

@app.websocket("/session/ws/{sid}")
async def session_ws(ws: WebSocket, sid: str):
    await ws.accept()
    key = _session_key(sid)
    meta = await r.hgetall(key)
    if not meta:
        await ws.send_text("Session not found\n"); await ws.close(); return

    tmpdir, exe = meta["tmpdir"], meta["exe"]

    try:
        proc = await asyncio.create_subprocess_exec(
            "stdbuf", "-oL", "-eL", exe,
            exe,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=tmpdir,
        )
    except Exception as e:
        await ws.send_text(f"Failed to start: {e}\n")
        await ws.close()
        await _kill_and_cleanup(key, tmpdir)
        return

    started_at = time.monotonic()
    last_output = time.monotonic()

    async def pump(stream):
        nonlocal last_output
        try:
            while True:
                chunk = await stream.read(1024)
                if not chunk: break
                last_output = time.monotonic()
                await ws.send_text(chunk.decode(errors="ignore"))
        except Exception:
            pass

    t_out = asyncio.create_task(pump(proc.stdout))
    t_err = asyncio.create_task(pump(proc.stderr))

    async def watchdog():
        try:
            while True:
                await asyncio.sleep(0.5)
                now = time.monotonic()
                if now - started_at > WALL_LIMIT_SEC:
                    await ws.send_text("\n[WALL TIME EXCEEDED]\n"); proc.kill(); break
                if now - last_output > IDLE_LIMIT_SEC:
                    await ws.send_text("\n[IDLE TIME EXCEEDED]\n"); proc.kill(); break
                if proc.returncode is not None: break
        except Exception:
            pass

    t_watch = asyncio.create_task(watchdog())

    try:
        while True:
            try:
                data = await ws.receive_text()
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
        try: proc.kill()
        except Exception: pass
        await asyncio.gather(t_out, t_err, t_watch, return_exceptions=True)
        await ws.close()
        await _kill_and_cleanup(key, tmpdir)

async def _kill_and_cleanup(key: str, tmpdir: str):
    try: await r.delete(key)
    except Exception: pass
    try: shutil.rmtree(tmpdir, ignore_errors=True)
    except Exception: pass
