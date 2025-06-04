import React, { useState, useEffect, useRef } from 'react';
import { Form, Button } from 'react-bootstrap';
import Prism from 'prismjs';

export default function ActivityPythonBlock({ code: initialCode, blockIndex }) {
  // ✅ Store the current code in React state (instead of only using props)
  const [code, setCode] = useState(initialCode);

  // ✅ Track if user is currently editing
  const [isEditing, setIsEditing] = useState(false);

  // ✅ Refs for syntax highlighting and output targeting
  const outputId = `sk-output-${blockIndex}`;
  const codeId = `sk-code-${blockIndex}`;
  const codeRef = useRef(null);

  // ✅ Re-highlight when user switches to read-only or code changes
  useEffect(() => {
    if (!isEditing && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [isEditing, code]); // react to code updates too!

  // ✅ Run the current `code` from state (not just the original props)
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

  return (
    <div className="mb-4">
      {/* ✅ Toggle edit mode */}
      <Button
        variant="secondary"
        className="mb-2 me-2"
        onClick={() => setIsEditing(!isEditing)}
      >
        {isEditing ? "Done Editing" : "Edit Code"}
      </Button>

      {/* ✅ Run current code */}
      <Button
        variant="primary"
        className="mb-2"
        onClick={runPython}
      >
        Run Python
      </Button>

      {/* ✅ If editing, show textarea controlled by state */}
      {isEditing ? (
        <Form.Control
          as="textarea"
          id={codeId}
          value={code} // ✅ controlled by state
          onChange={(e) => setCode(e.target.value)} // ✅ updates state on every keystroke
          rows={Math.max(6, code.split("\n").length)}
          className="font-monospace bg-dark text-white mt-2"
        />
      ) : (
        // ✅ When done editing, render the updated code
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

      {/* ✅ Output section (linked to blockIndex) */}
      <pre id={outputId} className="mt-2 bg-light p-2 border" />
    </div>
  );
}
