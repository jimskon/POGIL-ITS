// client/src/components/activity/ActivityCppBlock.jsx
import React, { useEffect, useRef, useState } from 'react';
import { Row, Col, Button, Form } from 'react-bootstrap';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function ActivityCppBlock({
  code: initialCode,
  responseKey,
  onCodeChange,
  timeLimit = 5000,
  editable = true,
}) {
  const [code, setCode] = useState(initialCode ?? '');
  const [isRunning, setIsRunning] = useState(false);

  // xterm + ws refs
  const termRef = useRef(null);
  const term = useRef(null);
  const fit = useRef(null);
  const wsRef = useRef(null);
  const onDataDisposeRef = useRef(null);

  // init terminal once
  useEffect(() => {
    term.current = new Terminal({
      cursorBlink: true,
      scrollback: 1000,
      disableStdin: false,
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      theme: { background: '#000000' },
    });
    fit.current = new FitAddon();
    term.current.loadAddon(fit.current);

    term.current.open(termRef.current);
    fit.current.fit();
    term.current.focus();

    const onResize = () => fit.current && fit.current.fit();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      try { onDataDisposeRef.current?.dispose(); } catch {}
      try { term.current?.dispose(); } catch {}
      try { wsRef.current?.close(); } catch {}
    };
  }, []);

  // ws URL helper
  const wsUrl = (sid) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/cxx-run/session/ws/${sid}`;
  };

  const runInteractive = async () => {
    // clear previous
    try { wsRef.current?.close(); } catch {}
    try { onDataDisposeRef.current?.dispose(); } catch {}
    term.current?.clear();
    term.current?.writeln('⏳ Compiling...');
    term.current?.focus();
    setIsRunning(true);

    try {
      const res = await fetch('/cxx-run/session/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const ctype = res.headers.get('content-type') || '';
      if (!ctype.includes('application/json')) {
        const text = await res.text();
        term.current.writeln(`❌ Non-JSON response:\n${text.slice(0, 400)}`);
        setIsRunning(false);
        return;
      }

      const data = await res.json();
      if (!data.ok) {
        term.current.writeln('❌ Compile error:\n');
        term.current.writeln(data.compile_error || '(no details)');
        setIsRunning(false);
        return;
      }

      // open websocket
      const ws = new WebSocket(wsUrl(data.sessionId));
      wsRef.current = ws;

      ws.onopen = () => {
        term.current.writeln('▶ Program started. Type input here; press Enter to send.');
        term.current.writeln('');
        term.current.focus();

        // LOCAL ECHO HANDLER (Option 1)
        const onData = (d) => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;

          // ENTER: show newline locally, send LF to program
          if (d === '\r') {
            term.current.write('\r\n');
            ws.send('\n');
            return;
          }

          // BACKSPACE: erase visually; still pass upstream
          if (d === '\u007F') { // DEL (Backspace)
            term.current.write('\b \b');
            ws.send(d);
            return;
          }

          // Optional: Ctrl+C passthrough
          if (d === '\u0003') { // ^C
            ws.send(d);
            return;
          }

          // Default: local echo + send upstream
          term.current.write(d);
          ws.send(d);
        };

        // avoid stacking across runs
        try { onDataDisposeRef.current?.dispose(); } catch {}
        onDataDisposeRef.current = term.current.onData(onData);
      };

      ws.onmessage = (ev) => {
        // server stdout/stderr chunks
        term.current.write(ev.data);
      };

      ws.onerror = () => {
        term.current.writeln('\r\n❌ [WebSocket error]');
      };

      ws.onclose = () => {
        try { onDataDisposeRef.current?.dispose(); } catch {}
        term.current.writeln('\r\n💡 [Program finished]');
        setIsRunning(false);
      };
    } catch (e) {
      term.current.writeln(`\n❌ Error: ${e.message}`);
      setIsRunning(false);
    }
  };

  return (
    <Row className="mb-4">
      {/* LEFT: live terminal */}
      <Col md={6}>
        <div
          ref={termRef}
          style={{ height: 420, background: '#000', borderRadius: 6, overflow: 'hidden' }}
        />
      </Col>

      {/* RIGHT: code editor + controls */}
      <Col md={6}>
        <div className="d-flex gap-2 mb-2">
          <Button
            variant="secondary"
            onClick={() => onCodeChange && onCodeChange(responseKey, code)}
            disabled={!editable}
          >
            Save
          </Button>

          <Button variant="primary" onClick={runInteractive} disabled={isRunning}>
            {isRunning ? 'Running…' : 'Run C++ (interactive)'}
          </Button>
        </div>

        <Form.Control
          as="textarea"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={Math.max(16, code.split('\n').length)}
          readOnly={false}          // <-- always editable when allowed
          className="font-monospace bg-dark text-light"
          style={{ minHeight: 420 }}
        />
      </Col>
    </Row>
  );
}
