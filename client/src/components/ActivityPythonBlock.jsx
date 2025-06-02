import React, { useEffect, useState } from 'react';
import Prism from 'prismjs';
import { Form } from 'react-bootstrap';

export default function ActivityPythonBlock({ code, blockIndex, editable = false }) {
  const [inputCode, setInputCode] = useState(code);

  // ✅ Highlight syntax when inputCode changes
  useEffect(() => {
    Prism.highlightAll();
  }, [inputCode]);

  const runCode = () => {
    // ✅ Find the unique output element by blockIndex
    const outputId = `output-${blockIndex}`;
    const outputArea = document.getElementById(outputId);
    if (outputArea) outputArea.textContent = ''; // Reset output area before running code

    // ✅ Configure Skulpt output to write to this specific block's output area
    window.Sk.configure({
      output: (text) => {
        if (outputArea) outputArea.textContent += text; // Append text to this block's output
      },
      read: (x) => {
        if (!window.Sk.builtinFiles || !window.Sk.builtinFiles["files"][x]) {
          throw new Error(`File not found: '${x}'`);
        }
        return window.Sk.builtinFiles["files"][x];
      }
    });

    // ✅ Reset Skulpt global state to avoid cross-block contamination
    window.Sk.globals = new window.Sk.builtin.dict([]);
    window.Sk.execLimit = null;

    // ✅ Use a unique module name per block to ensure clean execution
    window.Sk.misceval.asyncToPromise(() => window.Sk.importMainWithBody(`block_${blockIndex}`, false, inputCode))
      .catch(err => {
        if (outputArea) outputArea.textContent += err.toString(); // Show errors in output area
      });
  };

  return (
    <div className="mb-4">
      {/* ✅ Show editable textarea if editable, else show read-only code */}
      {editable ? (
        <Form.Control
          as="textarea"
          rows={6}
          value={inputCode}
          onChange={e => setInputCode(e.target.value)}
        />
      ) : (
        <pre className="bg-light p-3 rounded">
          <code className="language-python">{inputCode}</code>
        </pre>
      )}

      {/* ✅ Run button triggers code execution */}
      <button className="btn btn-primary btn-sm mt-2" onClick={runCode}>Run</button>

      {/* ✅ Output area for this block, unique by blockIndex */}
      <pre id={`output-${blockIndex}`} className="mt-2 bg-dark text-light p-2 rounded"></pre>
    </div>
  );
}


/*

export default function ActivityPythonBlock({ code, blockIndex, editable = false }) {
  const [output, setOutput] = useState('');
  const [inputCode, setInputCode] = useState(code);

  useEffect(() => {
    Prism.highlightAll();
  }, [inputCode]);

  const runCode = () => {
    setOutput('');
    window.Sk.configure({
      output: (text) => setOutput(prev => prev + text),
      read: (x) => {
        if (window.Sk.builtinFiles === undefined || !window.Sk.builtinFiles["files"][x]) {
          throw new Error(`File not found: '${x}'`);
        }
        return window.Sk.builtinFiles["files"][x];
      }
    });

    window.Sk.misceval.asyncToPromise(() => window.Sk.importMainWithBody(`<stdin>`, false, inputCode))
      .catch(err => setOutput(err.toString()));
  };

  return (
    <div className="mb-4">
      {editable ? (
        <Form.Control
          as="textarea"
          rows={6}
          value={inputCode}
          onChange={e => setInputCode(e.target.value)}
        />
      ) : (
        <pre className="bg-light p-3 rounded">
          <code className="language-python">{inputCode}</code>
        </pre>
      )}
      <button className="btn btn-primary btn-sm mt-2" onClick={runCode}>Run</button>
      <pre className="mt-2 bg-dark text-light p-2 rounded">{output}</pre>
    </div>
  );
}

export default function ActivityPythonBlock({ code, blockIndex, editable = false }) {
  const [output, setOutput] = useState('');
  const [inputCode, setInputCode] = useState(code);

  useEffect(() => {
    Prism.highlightAll();
  }, [inputCode]);

  const runCode = () => {
    setOutput('');
    window.Sk.configure({
      output: (text) => setOutput(prev => prev + text),
      read: (x) => {
        if (window.Sk.builtinFiles === undefined || !window.Sk.builtinFiles["files"][x]) {
          throw new Error(`File not found: '${x}'`);
        }
        return window.Sk.builtinFiles["files"][x];
      }
    });

    window.Sk.misceval.asyncToPromise(() => window.Sk.importMainWithBody(`<stdin>`, false, inputCode))
      .catch(err => setOutput(err.toString()));
  };

  return (
    <div className="mb-4">
      {editable ? (
        <Form.Control
          as="textarea"
          rows={6}
          value={inputCode}
          onChange={e => setInputCode(e.target.value)}
        />
      ) : (
        <pre className="bg-light p-3 rounded">
          <code className="language-python">{inputCode}</code>
        </pre>
      )}
      <button className="btn btn-primary btn-sm mt-2" onClick={runCode}>Run</button>
      <pre className="mt-2 bg-dark text-light p-2 rounded">{output}</pre>
    </div>
  );
}

*/