// src: client/src/components/activity/ActivityPythonBlock.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Form, Button } from 'react-bootstrap';
import Prism from 'prismjs';
import { runSkulptCode } from '../../utils/runSkulptCode';

export default function ActivityPythonBlock({
  code: initialCode,
  blockIndex,
  responseKey,
  onCodeChange,
  localOnly = false,
  codeFeedbackShown = {},
  fileContents,
  setFileContents,
  timeLimit,               // existing
  turtleTargetId,          // optional (only for \pythonturtle)
  turtleWidth = 600,       // optional
  turtleHeight = 400,      // optional
  editable = true,         // allow parent to gate editing
}) {
  const [code, setCode] = useState(initialCode ?? '');
  useEffect(() => { if (localOnly) setCode(initialCode ?? ''); }, [initialCode, localOnly]);

  const [savedCode, setSavedCode] = useState(initialCode ?? '');
  const [isEditing, setIsEditing] = useState(false);

  const codeId = `sk-code-${blockIndex}`;
  const codeRef = useRef(null);       // <code> (Prism)
  const taRef = useRef(null);         // <textarea>
  const gutterRef = useRef(null);     // gutter <pre>
  const codeScrollRef = useRef(null); // scrollable wrapper for Prism view
  const [outputText, setOutputText] = useState('');

  // --- live update plumbing (unchanged) ---
  const debounceMs = 300;
  const broadcastTimerRef = useRef(null);
  const lastInitialRef = useRef(initialCode ?? '');
  const lastSentRef = useRef(initialCode ?? '');
  const pendingRemoteRef = useRef(null);

  // highlight when not editing
  useEffect(() => {
    if (!isEditing && codeRef.current) Prism.highlightElement(codeRef.current);
  }, [isEditing, code]);

  // adopt external changes
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

  // --- line numbers + scroll sync ---
  const LINE_H = 1.45; // keep identical on gutter/textarea/pre/code

  const lineNumbers = useMemo(() => {
    const n = (code || '').split('\n').length || 1;
    return Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
  }, [code]);

  const syncGutterScroll = (top) => {
    if (gutterRef.current) gutterRef.current.scrollTop = top;
  };
  const onTextareaScroll   = () => { if (taRef.current)       syncGutterScroll(taRef.current.scrollTop); };
  const onCodeViewScroll   = () => { if (codeScrollRef.current) syncGutterScroll(codeScrollRef.current.scrollTop); };

  const runPython = () => {
    if (editable && code !== savedCode) {
      sendUpstream(code, { broadcastOnly: false });
      setSavedCode(code);
    }
    if (!window.Sk || !window.Sk.configure) {
      alert('Skulpt is still loading...');
      return;
    }
    const currentFiles = { ...fileContents };
    runSkulptCode({
      code,
      fileContents: currentFiles,
      setOutput: setOutputText,
      setFileContents,
      execLimit: timeLimit || 50000,
      turtleTargetId,
      turtleWidth,
      turtleHeight,
    });
  };

  const handleDoneEditing = () => {
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
  };

  // --- inline styles ---
  const mono =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

  const styles = {
    controls: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      marginBottom: 8,
      position: 'relative',
      zIndex: 2, // ensure above editor container
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
      overflow: 'hidden', // we sync scrollTop
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
      padding: '8px 10px', // same top padding as gutter for vertical align
    },
    codePre: {
      margin: 0,
      padding: 0,          // kill Prism’s default padding
      lineHeight: LINE_H,
      fontSize: '0.95rem',
      fontFamily: mono,
    },
    codeTag: {
      display: 'block',
      margin: 0,
      padding: 0,          // kill Prism’s code padding too
      lineHeight: LINE_H,
      fontSize: '0.95rem',
      fontFamily: mono,
      whiteSpace: 'pre',
    },
  };

  return (
    <div className="mb-4">
      {/* Controls */}
      <div style={styles.controls}>
        <Button
          variant="secondary"
          onClick={isEditing ? handleDoneEditing : () => { setIsEditing(true); flushPendingRemoteIfAny?.(); }}
        >
          {isEditing ? 'Done Editing' : 'Edit Code'}
        </Button>

        <Button variant="primary" onClick={runPython}>
          Run Python
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
            onBlur={handleDoneEditing}
            onScroll={onTextareaScroll}
            rows={Math.max(6, code.split('\n').length)}
            className="font-monospace mt-0"
            style={styles.textarea}
          />
        ) : (
          <div
            ref={codeScrollRef}
            style={styles.codeView}
            onScroll={onCodeViewScroll}
          >
            <pre style={styles.codePre}>
              <code
                id={codeId}
                ref={codeRef}
                className="language-python"
                style={styles.codeTag}
              >
                {code}
              </code>
            </pre>
          </div>
        )}
      </div>

      <pre className="mt-2 bg-light p-2 border">{outputText}</pre>

      {codeFeedbackShown[responseKey] && (
        <div className="mt-2 p-3 border rounded bg-warning-subtle">
          <strong>AI Feedback:</strong>
          <pre className="mb-0">{codeFeedbackShown[responseKey]}</pre>
        </div>
      )}

      {turtleTargetId && (
        <div
          id={turtleTargetId}
          style={{
            width: turtleWidth ?? 600,
            height: turtleHeight ?? 400,
            border: '1px solid #ddd',
            borderRadius: 6,
            marginTop: 8,
          }}
        />
      )}
    </div>
  );
}
