import React, { useState, useEffect, useRef } from 'react';
import { Form, Button } from 'react-bootstrap';
import Prism from 'prismjs';

export default function ActivityPythonBlock({ code: initialCode, blockIndex, responseKey, onCodeChange }) {
  const [code, setCode] = useState(initialCode);
  const [savedCode, setSavedCode] = useState(initialCode); // ✅ Track saved version
  const [isEditing, setIsEditing] = useState(false);

  const outputId = `sk-output-${blockIndex}`;
  const codeId = `sk-code-${blockIndex}`;
  const codeRef = useRef(null);

  useEffect(() => {
    if (!isEditing && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [isEditing, code]);

  // Optional: Reset if initialCode changes (e.g., new activity)
  useEffect(() => {
    setCode(initialCode);
    setSavedCode(initialCode);
  }, [initialCode]);

  const runPython = () => {
    const outputEl = document.getElementById(outputId);
    if (!outputEl) return;

    outputEl.textContent = '';

    if (!window.Sk || !window.Sk.configure) {
      alert("Skulpt is still loading...");
      return;
    }

    Sk.configure({
      output: (text) => (outputEl.textContent += text),
      read: (file) => {
        if (!Sk.builtinFiles?.["files"][file]) {
          throw `File not found: '${file}'`;
        }
        return Sk.builtinFiles["files"][file];
      },
    });

    Sk.misceval
      .asyncToPromise(() => Sk.importMainWithBody("__main__", false, code, true))
      .catch((err) => (outputEl.textContent = err.toString()));
  };

  const handleDoneEditing = () => {
    setIsEditing(false);
    if (code !== savedCode && onCodeChange && responseKey) {
      onCodeChange(responseKey, code);  // 🔥 Trigger backend save
      setSavedCode(code);              // ✅ Track saved version
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

      {isEditing ? (
        <Form.Control
          as="textarea"
          id={codeId}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={Math.max(6, code.split("\n").length)}
          className="font-monospace bg-dark text-white mt-2"
        />
      ) : (
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

      <pre id={outputId} className="mt-2 bg-light p-2 border" />
    </div>
  );
}
