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
  codeFeedbackShown = {},
  fileContents = {},
}) {
  const [code, setCode] = useState(initialCode);
  const [savedCode, setSavedCode] = useState(initialCode);
  const [isEditing, setIsEditing] = useState(false);

  const outputId = `sk-output-${blockIndex}`;
  const codeId = `sk-code-${blockIndex}`;
  const codeRef = useRef(null);
  const outputRef = useRef(null);
  const [outputText, setOutputText] = useState('');
  const fileContentsRef = useRef(fileContents);


  useEffect(() => {
    // This ensures runPython sees the latest fileContents
    fileContentsRef.current = fileContents;
    console.log("📥 Updated fileContentsRef:", fileContentsRef.current);
  }, [fileContents]);


  useEffect(() => {
    if (!isEditing && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [isEditing, code]);

  useEffect(() => {
    setCode(initialCode);
    setSavedCode(initialCode);
  }, [initialCode]);


const runPython = () => {
  if (!window.Sk || !window.Sk.configure) {
    alert("Skulpt is still loading...");
    return;
  }

  const currentFiles = { ...fileContentsRef.current };  // 🔍 force fresh copy
  console.log("🚀 Running with fileContents:", currentFiles); // ✅ must match latest edit

  runSkulptCode({
    code,
    fileContents: currentFiles,
    setOutput: setOutputText,
  });
};



  const handleDoneEditing = () => {
    setIsEditing(false);
    if (code !== savedCode && onCodeChange && responseKey) {
      onCodeChange(responseKey, code);
      setSavedCode(code);
      // ❌ Do NOT runPython here — we don't want to wipe output
      // setTimeout(runPython, 100);
    }
  };


  return (
    <div className="mb-4">
      <Button
        variant="secondary"
        className="mb-2 me-2"
        onClick={isEditing ? handleDoneEditing : () => setIsEditing(true)}
      >
        {isEditing ? "Done Editing" : "Edit Code"}
      </Button>

      <Button
        variant="primary"
        className="mb-2"
        onClick={runPython}
      >
        Run Python
      </Button>

      {isEditing && (
        <Form.Control
          as="textarea"
          id={codeId}
          data-response-key={responseKey}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={Math.max(6, code.split("\n").length)}
          className="font-monospace bg-dark text-white mt-2"
        />
      )}

      {!isEditing && (
        <pre className="mt-2">
          <code
            id={codeId}
            ref={codeRef}
            className="language-python"
          >
            {code}
          </code>
        </pre>
      )}


      <pre className="mt-2 bg-light p-2 border">{outputText}</pre>


      {/* ✅ AI Feedback block */}
      {codeFeedbackShown[responseKey] && (
        <div className="mt-2 p-3 border rounded bg-warning-subtle">
          <strong>AI Feedback:</strong>
          <pre className="mb-0">{codeFeedbackShown[responseKey]}</pre>
        </div>
      )}
    </div>
  );
}