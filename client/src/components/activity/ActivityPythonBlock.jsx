// src: client/src/components/activity/ActivityPythonBlock.jsx
import React, { useState, useEffect, useRef } from 'react';
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
  editable = true,         // NEW: allow parent to gate editing
}) {
  const [code, setCode] = useState(initialCode ?? '');
  // If the sheet changes, force local-only blocks to mirror it
  useEffect(() => {
    if (localOnly) setCode(initialCode ?? '');
  }, [initialCode, localOnly]);

  const [savedCode, setSavedCode] = useState(initialCode ?? '');
  const [isEditing, setIsEditing] = useState(false);

  const codeId = `sk-code-${blockIndex}`;
  const codeRef = useRef(null);
  const [outputText, setOutputText] = useState('');

  // --- live update plumbing ---
  const debounceMs = 300;
  const broadcastTimerRef = useRef(null);
  const lastInitialRef = useRef(initialCode ?? '');
  const lastSentRef = useRef(initialCode ?? ''); // de-dupe upstream sends
  const pendingRemoteRef = useRef(null);         // holds incoming code while editing

  // Syntax highlight when not editing
  useEffect(() => {
    if (!isEditing && codeRef.current) Prism.highlightElement(codeRef.current);
  }, [isEditing, code]);

  // Adopt external prop changes when they truly change.
  useEffect(() => {
    const next = initialCode ?? '';
    if (next === lastInitialRef.current) return;

    lastInitialRef.current = next;

    if (isEditing) {
      // Defer remote update until editing stops
      pendingRemoteRef.current = next;
    } else {
      setCode(next);
      setSavedCode(next);
      lastSentRef.current = next;
      pendingRemoteRef.current = null;
    }
  }, [initialCode, isEditing]);

  // Cleanup any pending broadcast timer on unmount
  useEffect(() => {
    return () => {
      if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
    };
  }, []);

  const sendUpstream = (val, { broadcastOnly = false } = {}) => {
    if (!onCodeChange || !responseKey) return;
    if (val === lastSentRef.current) return; // de-dupe
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

  const runPython = () => {
    // Flush current code (commit) before running
    if (editable && code !== savedCode) {
      sendUpstream(code, { broadcastOnly: false });
      setSavedCode(code);
    }

    if (!window.Sk || !window.Sk.configure) {
      alert('Skulpt is still loading...');
      return;
    }

    const currentFiles = { ...fileContents }; // fresh copy for Skulpt
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
    // Flush debounced timer immediately
    if (broadcastTimerRef.current) {
      clearTimeout(broadcastTimerRef.current);
      broadcastTimerRef.current = null;
    }
    // Commit final value
    if (editable && code !== savedCode) {
      sendUpstream(code, { broadcastOnly: false });
      setSavedCode(code);
    }
    // Now apply any remote update that arrived while we were editing
    flushPendingRemoteIfAny();
  };

  return (
    <div className="mb-4">
      <Button
        variant="secondary"
        className="mb-2 me-2"
        onClick={isEditing ? handleDoneEditing : () => { setIsEditing(true); flushPendingRemoteIfAny?.(); }}
      >
        {isEditing ? 'Done Editing' : 'Edit Code'}
      </Button>

      <Button
        variant="primary"
        className="mb-2"
        onClick={runPython}
      >
        Run Python
      </Button>

      {isEditing ? (
        <Form.Control
          as="textarea"
          id={codeId}
          data-response-key={responseKey}
          value={code}
          readOnly={!isEditing}
          onChange={(e) => {
            const v = e.target.value;
            setCode(v);
            if (editable) scheduleBroadcast(v); // debounced live updates
          }}
          onBlur={handleDoneEditing} // flush on blur as well
          rows={Math.max(6, code.split('\n').length)}
          className="font-monospace bg-dark text-white mt-2"
        />
      ) : (
        <pre className="mt-2">
          <code id={codeId} ref={codeRef} className="language-python">
            {code}
          </code>
        </pre>
      )}

      <pre className="mt-2 bg-light p-2 border">{outputText}</pre>

      {codeFeedbackShown[responseKey] && (
        <div className="mt-2 p-3 border rounded bg-warning-subtle">
          <strong>AI Feedback:</strong>
          <pre className="mb-0">{codeFeedbackShown[responseKey]}</pre>
        </div>
      )}
    </div>
  );
}
