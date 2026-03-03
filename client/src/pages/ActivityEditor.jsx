import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Alert } from 'react-bootstrap';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';
import { API_BASE_URL } from '../config';
import { Modal, Spinner, Tabs, Tab } from 'react-bootstrap';

export default function ActivityEditor() {
  const { activityId } = useParams();
  const [activity, setActivity] = useState(null);
  const [rawText, setRawText] = useState('');
  const [elements, setElements] = useState([]);
  const [skulptLoaded, setSkulptLoaded] = useState(false);
  const [copySuccess, setCopySuccess] = useState('');
  const [previewKey, setPreviewKey] = useState(Date.now());
  const [autoCompileEnabled, setAutoCompileEnabled] = useState(true);
  // NEW: right-side display mode + parse issues
  const [rightPaneMode, setRightPaneMode] = useState('preview'); // 'preview' | 'errors'
  const [parseIssues, setParseIssues] = useState([]);
  const compileReasonRef = useRef('auto'); // 'auto' | 'manual'

  // 🔁 New states and ref for file contents (for Python blocks)
  const [fileContents, setFileContents] = useState({});
  const fileContentsRef = useRef({});

  // ---- Auto-fix state ----
  const docBeforeAutofixRef = useRef('');

  const [autofixOpen, setAutofixOpen] = useState(false);
  const [autofixBusy, setAutofixBusy] = useState(false);
  const [autofixError, setAutofixError] = useState('');

  const [autofixProposedText, setAutofixProposedText] = useState('');
  const [autofixSummary, setAutofixSummary] = useState([]);
  const [autofixWarnings, setAutofixWarnings] = useState([]);

  const [autofixBlocks, setAutofixBlocks] = useState([]);
  const [autofixElements, setAutofixElements] = useState([]);
  const [autofixIssuesAfter, setAutofixIssuesAfter] = useState([]);

  const handleUpdateFileContents = (updaterFn) => {
    setFileContents((prev) => {
      const updated = updaterFn(prev);
      fileContentsRef.current = updated;
      return updated;
    });
  };
  function toGoogleDocEditUrl(url) {
    const s = String(url || "").trim();
    if (!s) return null;

    const m = s.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return `https://docs.google.com/document/d/${m[1]}/edit`;

    const m2 = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m2) return `https://docs.google.com/document/d/${m2[1]}/edit`;

    return s; // fallback
  }
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
          setTimeout(() => handleCompile(cached), 0);
        } else {
          const docRes = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`);
          const { lines } = await docRes.json();
          const text = lines.join('\n');
          setRawText(text);
          localStorage.setItem(`activity-${activityId}`, text);
          setTimeout(() => handleCompile(text), 0);
        }
      } catch (err) {
        console.error("Failed to fetch activity", err);
      }
    };

    if (skulptLoaded) fetchActivity();
  }, [activityId, skulptLoaded]);

  // 🔁 Compile handler
  // 🔁 Compile handler
  const handleCompile = (sourceText = rawText, reason = 'auto') => {
    compileReasonRef.current = reason;

    const lines = sourceText.split('\n');

    // ✅ request issues
    const parsed = parseSheetToBlocks(lines, { returnIssues: true });
    const blocks = parsed?.blocks ?? parsed; // backward-safe
    const issues = parsed?.issues ?? [];

    setParseIssues(issues);

    // ✅ Extract files for Python execution
    const files = {};
    for (const block of blocks) {
      if (block.type === 'file' && block.filename) {
        files[block.filename] = block.content ?? '';
      }
    }
    setFileContents(files);
    fileContentsRef.current = files;

    // ✅ IMPORTANT: pass fileContents (not fileContentsRef) into renderBlocks
    const rendered = renderBlocks(blocks, {
      mode: 'preview',
      editable: true,
      fileContents: files,
      setFileContents: handleUpdateFileContents,
    });

    setElements(rendered);
    setPreviewKey(Date.now());
    localStorage.setItem(`activity-${activityId}`, sourceText);

    // ✅ only auto-switch to errors on MANUAL compile
    if (reason === 'manual' && issues.some(i => i.severity === 'error')) {
      setRightPaneMode('errors');
    }
  };
  // Auto-compile on change
  useEffect(() => {
    if (autoCompileEnabled && rawText.trim()) {
      handleCompile();
    }
  }, [rawText, autoCompileEnabled]);

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

  const handleRecover = async () => {
    if (!activity?.sheet_url) return;

    const confirmed = window.confirm("This will discard all unsaved changes and recover the original text from the source document. Are you sure?");
    if (!confirmed) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activity.sheet_url)}`);
      const { lines } = await res.json();
      const recoveredText = lines.join('\n');
      setRawText(recoveredText);
      localStorage.setItem(`activity-${activityId}`, recoveredText);
      handleCompile(recoveredText);
    } catch (err) {
      console.error("Failed to recover original text", err);
    }
  };

  const runAutofix = async () => {
    setAutofixError('');

    // Always parse locally first; if no issues, you can still allow it, but I'd block by default.
    const parsed = parseSheetToBlocks(rawText.split('\n'), { returnIssues: true });
    const issuesNow = parsed?.issues ?? [];

    if (!issuesNow.length) {
      setAutofixError("No parser issues found — nothing to auto-correct.");
      setAutofixOpen(true);
      return;
    }

    docBeforeAutofixRef.current = rawText;
    setAutofixBusy(true);
    setAutofixOpen(true);

    try {
      // Load markup spec from public
      const specRes = await fetch('/MarkUp.md', { cache: 'no-store' });
      if (!specRes.ok) {
        throw new Error(`Failed to load MarkUp.md (${specRes.status})`);
      }
      const markupSpec = await specRes.text();

      // Call server (server only does AI; parser remains frontend authority)
      const res = await fetch(`${API_BASE_URL}/api/ai/code/repair-markup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docText: rawText,
          issues: issuesNow,
          markupSpec,
          options: {
            // if you want to pass mode or other hints
            mode: 'authoring',
          },
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Autofix request failed (${res.status}). ${txt}`.trim());
      }

      const data = await res.json();
      const proposed = data.proposedDocText || data.proposed || '';

      if (!proposed.trim()) {
        throw new Error('AI returned an empty proposed document.');
      }

      setAutofixProposedText(proposed);
      setAutofixSummary(Array.isArray(data.summary) ? data.summary : []);
      setAutofixWarnings(Array.isArray(data.warnings) ? data.warnings : []);

      // Re-parse proposed locally
      const parsed2 = parseSheetToBlocks(proposed.split('\n'), { returnIssues: true });
      const blocks2 = parsed2?.blocks ?? parsed2;
      const issuesAfter = parsed2?.issues ?? [];

      setAutofixBlocks(blocks2);
      setAutofixIssuesAfter(issuesAfter);

      // Build fileContents for preview (same as compile logic)
      const files2 = {};
      for (const b of blocks2) {
        if (b.type === 'file' && b.filename) {
          files2[b.filename] = b.content ?? '';
        }
      }

      const rendered2 = renderBlocks(blocks2, {
        mode: 'preview',
        editable: true,
        fileContents: files2,
        setFileContents: handleUpdateFileContents,
      });

      setAutofixElements(rendered2);
    } catch (e) {
      setAutofixError(e?.message || String(e));
    } finally {
      setAutofixBusy(false);
    }
  };

  const acceptAutofix = () => {
    if (!autofixProposedText) return;

    setRawText(autofixProposedText);
    localStorage.setItem(`activity-${activityId}`, autofixProposedText);

    // compile it immediately (manual reason so it can flip to errors if still bad)
    handleCompile(autofixProposedText, 'manual');

    // close modal + clear proposal
    setAutofixOpen(false);
    setAutofixProposedText('');
    setAutofixSummary([]);
    setAutofixWarnings([]);
    setAutofixBlocks([]);
    setAutofixElements([]);
    setAutofixIssuesAfter([]);
    setAutofixError('');
  };

  const closeAutofix = () => {
    // We never mutated rawText unless Accept, so closing is safe.
    setAutofixOpen(false);
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
        .right-pane-header {
          position: sticky;
          top: 0;
          background: #fafafa;
          z-index: 5;
          padding: 0.25rem 0.25rem 0.5rem 0.25rem;
          border-bottom: 1px solid #ddd;
        }
      `}</style>

      <div className="editor-header d-flex justify-content-between align-items-center mb-2">
        <h4>Edit Activity: {activity?.title}</h4>
        <div>
          <Form.Check
            type="switch"
            id="auto-compile-switch"
            label="Auto Compile"
            checked={autoCompileEnabled}
            onChange={() => setAutoCompileEnabled(prev => !prev)}
            className="ms-3"
          />
          <Button variant="success" onClick={runAutofix} className="me-2">
            Auto Correct
          </Button>
          <Button variant="primary" onClick={() => handleCompile(rawText, 'manual')}>Compile</Button>          <Button variant="secondary" onClick={handleCopy}>Copy</Button>{' '}
          <Button variant="warning" onClick={handleRecover}>Reread</Button>
          {activity?.sheet_url && (
            <Button
              variant="outline-primary"
              onClick={() => {
                const url = toGoogleDocEditUrl(activity.sheet_url);
                if (url) window.open(url, "_blank", "noopener,noreferrer");
              }}
            >
              Open Doc
            </Button>
          )}
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
          <div className="right-pane-header d-flex justify-content-between align-items-center">
            <div className="text-muted small">
              {rightPaneMode === 'preview' ? 'Preview' : 'Parser issues'}
              {parseIssues?.length ? ` · ${parseIssues.length}` : ''}
            </div>

            <Form.Check
              type="switch"
              id="preview-errors-switch"
              label={rightPaneMode === 'preview' ? 'Preview' : 'Errors'}
              checked={rightPaneMode === 'errors'}
              onChange={() => setRightPaneMode(m => (m === 'preview' ? 'errors' : 'preview'))}
            />
          </div>

          {rightPaneMode === 'preview' ? (
            elements
          ) : (
            <div className="mt-2">
              {!parseIssues?.length ? (
                <Alert variant="success" className="py-2 mb-2">
                  No parser issues found.
                </Alert>
              ) : (
                <>
                  <Alert variant="warning" className="py-2 mb-2">
                    Showing issues found while parsing. (These are not runtime errors.)
                  </Alert>

                  {parseIssues.map((iss, i) => (
                    <Alert
                      key={`iss-${i}`}
                      variant={iss.severity === 'error' ? 'danger' : (iss.severity === 'warn' ? 'warning' : 'secondary')}
                      className="py-2 mb-2"
                    >
                      <div className="d-flex justify-content-between">
                        <strong>{iss.severity.toUpperCase()}</strong>
                        <span className="text-muted">
                          {typeof iss.line === 'number' ? `Line ${iss.line}` : ''}
                        </span>
                      </div>
                      <div>{iss.message}</div>
                      {iss.context ? (
                        <div className="mt-1">
                          <code style={{ whiteSpace: 'pre-wrap' }}>{iss.context}</code>
                        </div>
                      ) : null}
                    </Alert>
                  ))}
                </>
              )}
            </div>
          )}
        </Col>
      </Row>
      <Modal
        show={autofixOpen}
        onHide={closeAutofix}
        size="xl"
        backdrop="static"
        keyboard={!autofixBusy}
      >
        <Modal.Header closeButton={!autofixBusy}>
          <Modal.Title>Auto Correct Markup</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {autofixBusy ? (
            <div className="d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" />
              <div>Asking AI to propose fixes…</div>
            </div>
          ) : null}

          {autofixError ? (
            <Alert variant="danger" className="mt-2">
              {autofixError}
            </Alert>
          ) : null}

          {!autofixBusy && !autofixError && autofixProposedText ? (
            <>
              {autofixSummary?.length ? (
                <Alert variant="info" className="mt-2">
                  <div className="fw-bold mb-1">Summary</div>
                  <ul className="mb-0">
                    {autofixSummary.map((s, i) => <li key={`sum-${i}`}>{s}</li>)}
                  </ul>
                </Alert>
              ) : null}

              {autofixWarnings?.length ? (
                <Alert variant="warning" className="mt-2">
                  <div className="fw-bold mb-1">Warnings</div>
                  <ul className="mb-0">
                    {autofixWarnings.map((w, i) => <li key={`warn-${i}`}>{w}</li>)}
                  </ul>
                </Alert>
              ) : null}

              {autofixIssuesAfter?.length ? (
                <Alert variant={autofixIssuesAfter.some(x => x.severity === 'error') ? 'danger' : 'warning'} className="mt-2">
                  Remaining issues after fix: <strong>{autofixIssuesAfter.length}</strong>
                </Alert>
              ) : (
                <Alert variant="success" className="mt-2">
                  No parser issues after fix.
                </Alert>
              )}

              <Tabs defaultActiveKey="preview" className="mt-3">
                <Tab eventKey="preview" title="Preview">
                  <div className="mt-3" style={{ background: '#fff', padding: 12, border: '1px solid #ddd', borderRadius: 6 }}>
                    {autofixElements}
                  </div>
                </Tab>

                <Tab eventKey="diff" title="Before / After">
                  <Row className="mt-3">
                    <Col md={6}>
                      <div className="text-muted small mb-1">Before</div>
                      <Form.Control
                        as="textarea"
                        value={docBeforeAutofixRef.current}
                        readOnly
                        style={{ fontFamily: 'monospace', height: '50vh' }}
                      />
                    </Col>
                    <Col md={6}>
                      <div className="text-muted small mb-1">After (proposed)</div>
                      <Form.Control
                        as="textarea"
                        value={autofixProposedText}
                        readOnly
                        style={{ fontFamily: 'monospace', height: '50vh' }}
                      />
                    </Col>
                  </Row>
                </Tab>

                <Tab eventKey="issues" title="Issues After">
                  <div className="mt-3">
                    {!autofixIssuesAfter?.length ? (
                      <Alert variant="success">No issues.</Alert>
                    ) : (
                      autofixIssuesAfter.map((iss, i) => (
                        <Alert
                          key={`af-iss-${i}`}
                          variant={iss.severity === 'error' ? 'danger' : (iss.severity === 'warn' ? 'warning' : 'secondary')}
                          className="py-2 mb-2"
                        >
                          <div className="d-flex justify-content-between">
                            <strong>{iss.severity.toUpperCase()}</strong>
                            <span className="text-muted">
                              {typeof iss.line === 'number' ? `Line ${iss.line}` : ''}
                            </span>
                          </div>
                          <div>{iss.message}</div>
                          {iss.context ? (
                            <div className="mt-1">
                              <code style={{ whiteSpace: 'pre-wrap' }}>{iss.context}</code>
                            </div>
                          ) : null}
                        </Alert>
                      ))
                    )}
                  </div>
                </Tab>
              </Tabs>
            </>
          ) : null}
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={closeAutofix} disabled={autofixBusy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={acceptAutofix}
            disabled={autofixBusy || !autofixProposedText}
          >
            Accept Fix
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}
