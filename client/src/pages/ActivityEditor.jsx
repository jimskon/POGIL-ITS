import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Alert } from 'react-bootstrap';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';
import { API_BASE_URL } from '../config';

export default function ActivityEditor() {
  const { activityId } = useParams();
  const [activity, setActivity] = useState(null);
  const [rawText, setRawText] = useState('');
  const [elements, setElements] = useState([]);
  const [skulptLoaded, setSkulptLoaded] = useState(false);
  const [copySuccess, setCopySuccess] = useState('');
  const [previewKey, setPreviewKey] = useState(Date.now());

  // Load Skulpt
  useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });

    const loadSkulpt = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');
        setSkulptLoaded(true);
      } catch (err) {
        console.error("Skulpt failed to load", err);
      }
    };

    loadSkulpt();
  }, []);

  // Fetch activity and saved text
  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activities/${activityId}`);
        const activityData = await res.json();
        setActivity(activityData);

        const cached = localStorage.getItem(`activity-${activityId}`);
        if (cached) {
          setRawText(cached);
          setTimeout(() => handleCompile(), 0);
        } else {
          const docRes = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`);
          const { lines } = await docRes.json();
          const text = lines.join('\n');
          setRawText(text);
          localStorage.setItem(`activity-${activityId}`, text);
          setTimeout(() => handleCompile(), 0);
        }


      } catch (err) {
        console.error("Failed to fetch activity", err);
      }
    };

    if (skulptLoaded) fetchActivity();
  }, [activityId, skulptLoaded]);

  // Compile handler
  const handleCompile = () => {
    console.log('🧑‍💻 parseSheetToBlocks invoked');
    const lines = rawText.split('\n');
    console.log('📄 Compiling lines:', lines);
    const blocks = parseSheetToBlocks(lines);
    console.log('📦 Parsed blocks:', blocks);
    const rendered = renderBlocks(blocks, { mode: 'preview' });
    console.log('🧩 Rendered elements:', rendered);
    setElements(rendered);
    setPreviewKey(Date.now());
    localStorage.setItem(`activity-${activityId}`, rawText);
  };

  // Copy handler
  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(rawText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = rawText;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopySuccess('✅ Copied to clipboard!');
      setTimeout(() => setCopySuccess(''), 2000);
    } catch (err) {
      setCopySuccess('❌ Copy failed. Try manually.');
      console.error(err);
    }
  };

  return (
    <Container fluid style={{ height: '100vh', overflow: 'hidden', padding: '1rem' }}>
      <style>{`
        .editor-header {
          position: sticky;
          top: 0;
          background: white;
          z-index: 10;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid #ddd;
        }
        .editor-body {
          height: calc(100vh - 100px);
        }
        .scrollable-pane {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow-y: auto;
          background: #fafafa;
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        .code-editor {
          height: 90vh;
          width: 100%;
          border: none;
          resize: none;
          overflow-y: auto;
          font-family: monospace;
          font-size: 0.9rem;
          background: white;
          padding: 0.5rem;
          box-sizing: border-box;
          line-height: 1.4;
        }
      `}</style>

      <div className="editor-header d-flex justify-content-between align-items-center mb-2">
        <h4>Edit Activity: {activity?.title}</h4>
        <div>
          <Button variant="primary" onClick={handleCompile}>Compile</Button>{' '}
          <Button variant="secondary" onClick={handleCopy}>Copy</Button>
        </div>
      </div>

      {copySuccess && <Alert variant="info" className="py-1">{copySuccess}</Alert>}

      <Row className="editor-body">
        <Col md={6} className="scrollable-pane">
          <Form.Control
            as="textarea"
            className="code-editor"
            value={rawText}
            onChange={(e) => {
              const textarea = e.target;
              const scrollTop = textarea.scrollTop;
              setRawText(textarea.value);
              setTimeout(() => {
                textarea.scrollTop = scrollTop;
              }, 0);
            }}
            spellCheck={false}
          />
        </Col>
        <Col md={6} className="scrollable-pane" key={previewKey}>
          {elements}
        </Col>
      </Row>
    </Container>
  );
}
