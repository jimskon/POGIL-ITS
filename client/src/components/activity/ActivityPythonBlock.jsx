import React, { useState, useEffect, useRef } from 'react';
import { Form, Button } from 'react-bootstrap';
import Prism from 'prismjs';

export default function ActivityPythonBlock({ code, blockIndex }) {
  const [isEditing, setIsEditing] = useState(false);
  const outputId = `sk-output-${blockIndex}`;
  const codeId = `sk-code-${blockIndex}`;
  const codeRef = useRef(null); // Add a ref to <code>

  useEffect(() => {
    if (!isEditing && codeRef.current) {
      Prism.highlightElement(codeRef.current); // Highlight when shown
    }
  }, [isEditing]);

  const runPython = () => {
    const userCode = document.getElementById(codeId)?.value || code;
    const outputEl = document.getElementById(outputId);
    if (!outputEl) return;

    if (!window.Sk || !window.Sk.configure) {
      alert("Skulpt is still loading...");
      return;
    }

    outputEl.textContent = '';

    Sk.configure({
      output: (text) => (outputEl.textContent += text),
      read: (file) => {
        if (Sk.builtinFiles === undefined || Sk.builtinFiles["files"][file] === undefined) {
          throw `File not found: '${file}'`;
        }
        return Sk.builtinFiles["files"][file];
      },
    });

    Sk.misceval
      .asyncToPromise(() => Sk.importMainWithBody("__main__", false, userCode, true))
      .catch((err) => outputEl.textContent = err.toString());
  };

  return (
    <div className="mb-4">
      <Button
        variant="secondary"
        className="mb-2 me-2"
        onClick={() => setIsEditing(!isEditing)}
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
          defaultValue={code}
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
