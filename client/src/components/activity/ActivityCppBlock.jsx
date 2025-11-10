// src: client/src/components/activity/ActivityCppBlock.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Row, Col, Button, Form } from 'react-bootstrap';
import Prism from 'prismjs';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';

export default function ActivityCppBlock({
  code: initialCode,
  responseKey,
  onCodeChange,
  timeLimit = 5000,        // currently unused but kept for API compatibility
  editable = true,
  blockIndex = 0,
  localOnly = false,       // if true, don't send files / remote sync
  codeFeedbackShown = {},
  fileContents = {},       // { "data.txt": "10 20 30", ... }
  setFileContents,         // fn to update sheet-level file contents
}) {
  // --- code state ---
  const [code, setCode] = useState(initialCode ?? '');
  const [savedCode, setSavedCode] = useState(initialCode ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // keep track of last initial to avoid loops
  const lastInitialRef = useRef(initialCode ?? '');
  useEffect(() => {
    const next = initialCode ?? '';
    if (next === lastInitialRef.current) return;
    lastInitialRef.current = next;
    if (!isEditing) {
      setCode(next);
      setSavedCode(next);
      lastSentRef.current = next;
      pendingRemoteRef.current = null;
    } else {
      // if currently editing, queue remote update
      pendingRemoteRef.current = next;
    }
  }, [initialCode, isEditing]);

  // When localOnly toggles true, reset from initial
  useEffect(() => {
    if (localOnly) {
      const base = initialCode ?? '';
      setCode(base);
      setSavedCode(base);
    }
  }, [localOnly, initialCode]);

  // --- terminal + ws refs ---
  const termRef = useRef(null);
  const term = useRef(null);
  const fit = useRef(null);
  const wsRef = useRef(null);
  const onDataDisposeRef = useRef(null);
  const inputBufferRef = useRef('');

  // --- Prism / editor refs ---
  const codeId = `cpp-code-${blockIndex}`;
  const codeRef = useRef(null);
  const taRef = useRef(null);
  const gutterRef = useRef(null);
  const codeScrollRef = useRef(null);

  // --- debounce plumbing for broadcast / sync ---
  const debounceMs = 300;
  const broadcastTimerRef = useRef(null);
  const lastSentRef = useRef(initialCode ?? '');
  const pendingRemoteRef = useRef(null);

  useEffect(
    () => () => {
      if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
    },
    []
  );

  const sendUpstream = (val, { broadcastOnly = false } = {}) => {
    if (!onCodeChange || !responseKey) return;
    if (val === lastSentRef.current) return;
    lastSentRef.current = val;
    onCodeChange(
      responseKey,
      val,
      broadcastOnly ? { __broadcastOnly: true } : undefined
    );
  };

  const scheduleBroadcast = (val) => {
    if (!onCodeChange || !responseKey) return;
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
      requestAnimationFrame(() => {
        try {
          taRef.current.focus();
          const len = taRef.current.value.length;
          taRef.current.setSelectionRange(len, len);
        } catch {
          /* ignore */
        }
      });
    }
  }, [isEditing]);

  // Prism highlight when not editing
  useEffect(() => {
    if (!isEditing && codeRef.current) Prism.highlightElement(codeRef.current);
  }, [isEditing, code]);

  // init terminal once
  useEffect(() => {
    const t = new Terminal({
      cursorBlink: true,
      scrollback: 1000,
      disableStdin: false,
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      theme: { background: '#000000' },
    });
    const f = new FitAddon();
    t.loadAddon(f);

    t.open(termRef.current);
    f.fit();
    t.focus();

    term.current = t;
    fit.current = f;

    const onResize = () => {
      try {
        fit.current && fit.current.fit();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      try {
        onDataDisposeRef.current?.dispose();
      } catch {}
      try {
        term.current?.dispose();
      } catch {}
      try {
        wsRef.current?.close();
      } catch {}
    };
  }, []);

  // --- line numbers + scroll sync ---
  const LINE_H = 1.45;
  const EOL_SPLIT = /\r\n|\n|\r/;

  const lineNumbers = useMemo(() => {
    const n = Math.max(1, (code ?? '').split(EOL_SPLIT).length);
    return Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
  }, [code]);

  const syncGutterScroll = (top) => {
    if (gutterRef.current) gutterRef.current.scrollTop = top;
  };
  const onTextareaScroll = () => {
    if (taRef.current) syncGutterScroll(taRef.current.scrollTop);
  };
  const onCodeViewScroll = () => {
    if (codeScrollRef.current) syncGutterScroll(codeScrollRef.current.scrollTop);
  };

  // --- ws URL helper ---
  const wsUrl = (sid) => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/cxx-run/session/ws/${sid}`;
  };

  // --- unified run: interactive + sheet files ---
  const runInteractive = async () => {
    // close previous session if any
    try {
      wsRef.current?.close();
    } catch {}
    try {
      onDataDisposeRef.current?.dispose();
    } catch {}

    term.current?.clear();
    term.current?.writeln('Compiling...');
    term.current?.focus();
    setIsRunning(true);

    try {
      const payload = { code };

      // include sheet-authored files (e.g., data.txt, log.txt initial contents)
      // fileContents is a plain { filename: content } map from the parent
      if (!localOnly && fileContents && Object.keys(fileContents).length > 0) {
        payload.files = fileContents;
      }

      const res = await fetch('/cxx-run/session/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const ctype = res.headers.get('content-type') || '';
      if (!ctype.includes('application/json')) {
        const text = await res.text();
        term.current.writeln(`\r\n❌ Non-JSON response:\n${text.slice(0, 400)}`);
        setIsRunning(false);
        return;
      }

      const data = await res.json();
      if (!data.ok) {
        term.current.writeln('\r\n❌ Compile error:\n');
        term.current.writeln(data.compile_error || data.error || '(no details)');
        setIsRunning(false);
        return;
      }

      const ws = new WebSocket(wsUrl(data.sessionId));
      wsRef.current = ws;

      ws.onopen = () => {
        term.current.writeln(
          '▶ Program started. Type input; press Enter to send.'
        );
        term.current.writeln('');
        term.current.focus();
        inputBufferRef.current = '';

        const onData = (d) => {
          if (ws.readyState !== WebSocket.OPEN) return;

          // ENTER: send buffered line
          if (d === '\r') {
            const line = inputBufferRef.current;
            term.current.write('\r\n');
            ws.send(line + '\n');
            inputBufferRef.current = '';
            return;
          }

          // BACKSPACE
          if (d === '\u007F') {
            if (inputBufferRef.current.length > 0) {
              inputBufferRef.current = inputBufferRef.current.slice(0, -1);
              term.current.write('\b \b');
            }
            return;
          }

          // Ctrl+C
          if (d === '\u0003') {
            ws.send(d);
            inputBufferRef.current = '';
            term.current.write('^C\r\n');
            return;
          }

          // printable char
          if (d >= ' ' && d !== '\x7f') {
            inputBufferRef.current += d;
            term.current.write(d);
          }
        };

        try {
          onDataDisposeRef.current?.dispose();
        } catch {}
        onDataDisposeRef.current = term.current.onData(onData);
      };

      ws.onmessage = (ev) => {
        const msg = ev.data;

        // Convention: backend sends a final "[FILES]{json}" message
        // with any files created/updated in the sandbox.
        if (typeof msg === 'string' && msg.startsWith('[FILES]')) {
          if (setFileContents) {
            try {
              const updated = JSON.parse(msg.slice(7));
              // Merge: keep any files that already exist, overwrite updated ones.
              setFileContents((prev) => ({
                ...(prev || {}),
                ...(updated || {}),
              }));
            } catch (e) {
              term.current.writeln(
                '\r\n[Warning] Failed to parse returned files metadata.\r\n'
              );
            }
          }
          return;
        }

        // Normal program stdout/stderr stream
        term.current.write(
          typeof msg === 'string' ? msg : new TextDecoder().decode(msg)
        );
      };

      ws.onerror = () => {
        term.current.writeln('\r\n❌ [WebSocket error]');
      };

      ws.onclose = () => {
        try {
          onDataDisposeRef.current?.dispose();
        } catch {}
        inputBufferRef.current = '';
        term.current.writeln('\r\n[Program finished]');
        setIsRunning(false);
      };
    } catch (e) {
      term.current.writeln(`\r\n❌ Error: ${e.message}`);
      setIsRunning(false);
    }
  };

  // --- styles ---
  const mono =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  const styles = {
    controls: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      marginBottom: 8,
    },
    editorWrap: {
      display: 'flex',
      alignItems: 'stretch',
      width: '100%',
      border: '1px solid #dee2e6',
      borderRadius: '0.375rem',
      overflow: 'hidden',
      background: '#f8f9fa',
      fontFamily: mono,
      fontSize: '0.95rem',
      lineHeight: LINE_H,
      marginTop: '0.25rem',
    },
    gutter: {
      margin: 0,
      padding: '8px 8px 8px 12px',
      minWidth: '3ch',
      maxWidth: '8ch',
      color: '#6c757d',
      textAlign: 'right',
      userSelect: 'none',
      background: '#f1f3f5',
      borderRight: '1px solid #dee2e6',
      overflow: 'hidden',
      whiteSpace: 'pre',
      lineHeight: LINE_H,
      fontFamily: mono,
      fontSize: '0.95rem',
    },
    textarea: {
      flex: 1,
      border: 'none',
      outline: 'none',
      resize: 'vertical',
      padding: '8px 10px',
      background: '#212529',
      color: '#fff',
      minHeight: '160px',
      overflow: 'auto',
      whiteSpace: 'pre',
      lineHeight: LINE_H,
      fontFamily: mono,
      fontSize: '0.95rem',
    },
    codeView: {
      flex: 1,
      overflow: 'auto',
      background: '#fff',
      padding: '8px 10px',
    },
    codePre: {
      margin: 0,
      padding: 0,
      lineHeight: LINE_H,
      fontSize: '0.95rem',
      fontFamily: mono,
    },
    codeTag: {
      display: 'block',
      margin: 0,
      padding: 0,
      lineHeight: LINE_H,
      fontSize: '0.95rem',
      fontFamily: mono,
      whiteSpace: 'pre',
    },
  };

  return (
    <Row className="mb-4">
      {/* LEFT: live terminal */}
      <Col md={6}>
        <div
          ref={termRef}
          style={{
            height: 420,
            background: '#000',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        />
      </Col>

      {/* RIGHT: code editor + controls */}
      <Col md={6}>
        <div style={styles.controls}>
          <Button
            variant="secondary"
            onClick={() => {
              if (!editable) return;
              if (isEditing) {
                // leaving edit mode
                setIsEditing(false);
                if (broadcastTimerRef.current) {
                  clearTimeout(broadcastTimerRef.current);
                  broadcastTimerRef.current = null;
                }
                if (editable && code !== savedCode) {
                  sendUpstream(code, { broadcastOnly: false });
                  setSavedCode(code);
                }
                flushPendingRemoteIfAny();
              } else {
                // entering edit mode
                setIsEditing(true);
                flushPendingRemoteIfAny();
              }
            }}
          >
            {isEditing ? 'Done Editing' : 'Edit Code'}
          </Button>

          <Button
            variant="secondary"
            onClick={() => {
              if (!editable || !onCodeChange || !responseKey) return;
              onCodeChange(responseKey, code);
              setSavedCode(code);
            }}
            disabled={!editable}
          >
            Save
          </Button>

          <Button
            variant="primary"
            onClick={runInteractive}
            disabled={isRunning}
          >
            {isRunning ? 'Running…' : 'Run C++'}
          </Button>
        </div>

        {/* Editor / Viewer with line-number gutter */}
        <div style={styles.editorWrap}>
          <pre ref={gutterRef} style={styles.gutter} aria-hidden="true">
            {lineNumbers}
          </pre>

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
                if (broadcastTimerRef.current) {
                  clearTimeout(broadcastTimerRef.current);
                  broadcastTimerRef.current = null;
                }
                if (editable && code !== savedCode) {
                  sendUpstream(code, { broadcastOnly: false });
                  setSavedCode(code);
                }
                flushPendingRemoteIfAny();
              }}
              onScroll={onTextareaScroll}
              rows={Math.max(16, (code ?? '').split(EOL_SPLIT).length)}
              className="font-monospace mt-0 bg-dark text-light"
              style={{ ...styles.textarea, minHeight: 420 }}
            />
          ) : (
            <div
              ref={codeScrollRef}
              style={{ ...styles.codeView, minHeight: 420 }}
              onScroll={onCodeViewScroll}
            >
              <pre style={styles.codePre}>
                <code
                  id={codeId}
                  ref={codeRef}
                  className="language-cpp"
                  style={styles.codeTag}
                >
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
