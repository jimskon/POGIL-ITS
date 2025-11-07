// src: client/src/components/activity/ActivityCppBlock.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Row, Col, Button, Form } from 'react-bootstrap';
import Prism from 'prismjs';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

// Ensure these are imported once globally (e.g., App.jsx or a Prism setup file):
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';

export default function ActivityCppBlock({
  code: initialCode,
  responseKey,
  onCodeChange,
  timeLimit = 5000,
  editable = true,
  blockIndex = 0,           // for unique element ids
  localOnly = false,        // mirror Python block semantics
  codeFeedbackShown = {},   // optional AI feedback area
}) {
  // --- code state ---
  const [code, setCode] = useState(initialCode ?? '');
  useEffect(() => { if (localOnly) setCode(initialCode ?? ''); }, [initialCode, localOnly]);
  const [savedCode, setSavedCode] = useState(initialCode ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // --- xterm + ws refs ---
  const termRef = useRef(null);
  const term = useRef(null);
  const fit = useRef(null);
  const wsRef = useRef(null);
  const onDataDisposeRef = useRef(null);
  const inputBufferRef = useRef('');


  // --- Prism refs ---
  const codeId = `cpp-code-${blockIndex}`;
  const codeRef = useRef(null);       // <code> (Prism)
  const taRef = useRef(null);         // <textarea>
  const gutterRef = useRef(null);     // gutter <pre>
  const codeScrollRef = useRef(null); // scrollable wrapper for Prism view

  // --- debounce plumbing (parity with Python block) ---
  const debounceMs = 300;
  const broadcastTimerRef = useRef(null);
  const lastInitialRef = useRef(initialCode ?? '');
  const lastSentRef = useRef(initialCode ?? '');
  const pendingRemoteRef = useRef(null);

  useEffect(() => () => {
    if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
  }, []);

  const sendUpstream = (val, { broadcastOnly = false } = {}) => {
    if (!onCodeChange || !responseKey) return;
    if (val === lastSentRef.current) return;
    lastSentRef.current = val;
    onCodeChange(responseKey, val, broadcastOnly ? { __broadcastOnly: true } : undefined);
  };

  const scheduleBroadcast = (val) => {
    if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
    broadcastTimerRef.current = setTimeout(() => {
      sendUpstream(val, { broadcastOnly: true });
      broadcastTimerRef.current = null;
    }, debounceMs);
  };

  const flushPendingRemoteIfAny = () => {
    if (pendingRemoteRef.current != null) {
      const incoming = pendingRemoteRef.current;
      pendingRemoteRef.current = null;
      setCode(incoming);
      setSavedCode(incoming);
      lastSentRef.current = incoming;
    }
  };

  // focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && taRef.current) {
      // defer to next paint so the node exists
      requestAnimationFrame(() => {
        try {
          taRef.current.focus();
          // optional: move caret to end
          const len = taRef.current.value.length;
          taRef.current.setSelectionRange(len, len);
        } catch { }
      });
    }
  }, [isEditing]);

  // --- adopt external changes ---
  useEffect(() => {
    const next = initialCode ?? '';
    if (next === lastInitialRef.current) return;
    lastInitialRef.current = next;
    if (isEditing) pendingRemoteRef.current = next;
    else {
      setCode(next);
      setSavedCode(next);
      lastSentRef.current = next;
      pendingRemoteRef.current = null;
    }
  }, [initialCode, isEditing]);

  // --- Prism: highlight when not editing ---
  useEffect(() => {
    if (!isEditing && codeRef.current) Prism.highlightElement(codeRef.current);
  }, [isEditing, code]);

  // --- init terminal once ---
  useEffect(() => {
    term.current = new Terminal({
      cursorBlink: true,
      scrollback: 1000,
      disableStdin: false,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
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
      try { onDataDisposeRef.current?.dispose(); } catch { }
      try { term.current?.dispose(); } catch { }
      try { wsRef.current?.close(); } catch { }
    };
  }, []);

  // --- line numbers + scroll sync ---
  const LINE_H = 1.45; // keep identical on gutter/textarea/pre/code
  const EOL_SPLIT = /\r\n|\n|\r/;

  const lineNumbers = useMemo(() => {
    // split on any platform EOL, then join with a single '\n' for the gutter
    const n = Math.max(1, (code ?? '').split(EOL_SPLIT).length);
    return Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
  }, [code]);

  const syncGutterScroll = (top) => { if (gutterRef.current) gutterRef.current.scrollTop = top; };
  const onTextareaScroll = () => { if (taRef.current) syncGutterScroll(taRef.current.scrollTop); };
  const onCodeViewScroll = () => { if (codeScrollRef.current) syncGutterScroll(codeScrollRef.current.scrollTop); };

  // --- ws URL helper ---
  const wsUrl = (sid) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/cxx-run/session/ws/${sid}`;
  };

  // --- run C++ (interactive) ---
  const runInteractive = async () => {
    // clear previous
    try { wsRef.current?.close(); } catch { }
    try { onDataDisposeRef.current?.dispose(); } catch { }
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

        inputBufferRef.current = '';

        const onData = (d) => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;

          // ENTER: send the whole buffered line
          if (d === '\r') { // xterm sends '\r' for Enter
            const line = inputBufferRef.current;
            term.current.write('\r\n');        // move to next line visually
            ws.send(line + '\n');             // send line + newline to the program
            inputBufferRef.current = '';      // reset buffer
            return;
          }

          // BACKSPACE
          if (d === '\u007F') {
            if (inputBufferRef.current.length > 0) {
              // Remove last char from buffer
              inputBufferRef.current = inputBufferRef.current.slice(0, -1);
              // Erase last char visually
              term.current.write('\b \b');
            }
            return;
          }

          // Ctrl+C — send immediately (signal/interrupt)
          if (d === '\u0003') {
            ws.send(d);
            inputBufferRef.current = '';
            term.current.write('^C\r\n');
            return;
          }

          // For now, treat everything else as normal character input:
          // append to buffer and echo locally, but DO NOT send yet.
          // This includes spaces, digits, letters, etc.
          if (d >= ' ' && d !== '\x7f') {
            inputBufferRef.current += d;
            term.current.write(d);
          }
        };

        try { onDataDisposeRef.current?.dispose(); } catch { }
        onDataDisposeRef.current = term.current.onData(onData);
      };

      ws.onmessage = (ev) => { term.current.write(ev.data); };
      ws.onerror = () => { term.current.writeln('\r\n❌ [WebSocket error]'); };
      ws.onclose = () => {
        try { onDataDisposeRef.current?.dispose(); } catch { }
        inputBufferRef.current = '';
        term.current.writeln('\r\n💡 [Program finished]');
        setIsRunning(false);
      };

    } catch (e) {
      term.current.writeln(`\n❌ Error: ${e.message}`);
      setIsRunning(false);
    }
  };

  // --- inline styles ---
  const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  const styles = {
    controls: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
    editorWrap: {
      display: 'flex', alignItems: 'stretch', width: '100%', border: '1px solid #dee2e6',
      borderRadius: '0.375rem', overflow: 'hidden', background: '#f8f9fa', fontFamily: mono,
      fontSize: '0.95rem', lineHeight: LINE_H, marginTop: '0.25rem',
    },
    gutter: {
      margin: 0, padding: '8px 8px 8px 12px', minWidth: '3ch', maxWidth: '8ch', color: '#6c757d',
      textAlign: 'right', userSelect: 'none', background: '#f1f3f5', borderRight: '1px solid #dee2e6',
      overflow: 'hidden', whiteSpace: 'pre', lineHeight: LINE_H, fontFamily: mono, fontSize: '0.95rem',
    },
    textarea: {
      flex: 1, border: 'none', outline: 'none', resize: 'vertical', padding: '8px 10px',
      background: '#212529', color: '#fff', minHeight: '160px', overflow: 'auto', whiteSpace: 'pre',
      lineHeight: LINE_H, fontFamily: mono, fontSize: '0.95rem',
    },
    codeView: { flex: 1, overflow: 'auto', background: '#fff', padding: '8px 10px' },
    codePre: { margin: 0, padding: 0, lineHeight: LINE_H, fontSize: '0.95rem', fontFamily: mono },
    codeTag: { display: 'block', margin: 0, padding: 0, lineHeight: LINE_H, fontSize: '0.95rem', fontFamily: mono, whiteSpace: 'pre' },
  };

  return (
    <Row className="mb-4">
      {/* LEFT: live terminal */}
      <Col md={6}>
        <div ref={termRef} style={{ height: 420, background: '#000', borderRadius: 6, overflow: 'hidden' }} />
      </Col>

      {/* RIGHT: code editor + controls with Prism viewer */}
      <Col md={6}>
        <div style={styles.controls}>
          <Button
            variant="secondary"
            onClick={() => {
              console.log('[ActivityCppBlock] editable=', editable, 'isEditing(before)=', isEditing);
              if (!editable) return;
              if (isEditing) {
                setIsEditing(false);
                if (broadcastTimerRef.current) { clearTimeout(broadcastTimerRef.current); broadcastTimerRef.current = null; }
                if (editable && code !== savedCode) { sendUpstream(code, { broadcastOnly: false }); setSavedCode(code); }
                flushPendingRemoteIfAny();
              } else {
                setIsEditing(true);
                flushPendingRemoteIfAny();
              }
            }}
          >
            {isEditing ? 'Done Editing' : 'Edit Code'}
          </Button>

          <Button
            variant="secondary"
            onClick={() => editable && onCodeChange && onCodeChange(responseKey, code)}
            disabled={!editable}
          >
            Save
          </Button>

          <Button variant="primary" onClick={runInteractive} disabled={isRunning}>
            {isRunning ? 'Running…' : 'Run C++ (interactive)'}
          </Button>
        </div>

        {/* Editor / Viewer with line-number gutter */}
        <div style={styles.editorWrap}>
          <pre ref={gutterRef} style={styles.gutter} aria-hidden="true">{lineNumbers}</pre>

          {isEditing ? (
            <Form.Control
              as="textarea"
              ref={taRef}
              id={codeId}
              data-response-key={responseKey}
              value={code}
              readOnly={!isEditing}
              onChange={(e) => {
                const v = e.target.value;
                setCode(v);
                if (editable) scheduleBroadcast(v);
              }}
              onBlur={() => {
                setIsEditing(false);
                if (broadcastTimerRef.current) { clearTimeout(broadcastTimerRef.current); broadcastTimerRef.current = null; }
                if (editable && code !== savedCode) { sendUpstream(code, { broadcastOnly: false }); setSavedCode(code); }
                flushPendingRemoteIfAny();
              }}
              onScroll={onTextareaScroll}
              rows={Math.max(16, (code ?? '').split(EOL_SPLIT).length)}
              className="font-monospace mt-0 bg-dark text-light"
              style={{ ...styles.textarea, minHeight: 420 }}
            />
          ) : (
            <div ref={codeScrollRef} style={{ ...styles.codeView, minHeight: 420 }} onScroll={onCodeViewScroll}>
              <pre style={styles.codePre}>
                <code id={codeId} ref={codeRef} className="language-cpp" style={styles.codeTag}>
                  {code}
                </code>
              </pre>
            </div>
          )}
        </div>

        {codeFeedbackShown[responseKey] && (
          <div className="mt-2 p-3 border rounded bg-warning-subtle">
            <strong>AI Feedback:</strong>
            <pre className="mb-0">{codeFeedbackShown[responseKey]}</pre>
          </div>
        )}
      </Col>
    </Row>
  );
}
