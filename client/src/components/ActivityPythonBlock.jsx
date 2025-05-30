// /client/src/components/ActivityPythonBlock.jsx
import React, { useEffect, useState } from 'react';
import { Form } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';

export default function ActivityPythonBlock({ code, editable, questionId, codeIndex, setCodeAnswers }) {
  const [value, setValue] = useState(code || '');

  // Keep Prism syntax highlighting fresh
  useEffect(() => {
    Prism.highlightAll();
  }, [value]);

  // Track student input in parent's state
useEffect(() => {
  if (editable && setCodeAnswers && questionId && codeIndex !== undefined) {
    setCodeAnswers(prev => ({
      ...prev,
      [`${questionId}CODE${codeIndex + 1}`]: value
    }));
  }
}, [value, editable, questionId, codeIndex, setCodeAnswers]);


  return (
    <div className="mb-3">
      <Form.Label><strong>Python Code Block</strong></Form.Label>
      <Form.Control
        as="textarea"
        rows={6}
        className="font-monospace"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        readOnly={!editable}
        style={{ backgroundColor: '#f9f9f9', resize: 'vertical' }}
      />
      <pre className="language-python mt-2"><code className="language-python">{value}</code></pre>
    </div>
  );
}
