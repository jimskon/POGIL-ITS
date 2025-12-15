// client/src/components/QuestionScorePanel.jsx
import React, { useEffect, useState } from 'react';
import { Card, Form, Button } from 'react-bootstrap';

export default function QuestionScorePanel({
  qid,
  displayNumber,
  scores,
  allowEdit,
  onSave,
}) {
  const {
    codeScore,
    runScore,
    respScore,
    codeExplain,
    runExplain,
    respExplain,
    maxCode,
    maxRun,
    maxResp,
  } = scores || {};

  // If this question truly has no scoring bands at all, don’t render anything.
  if ((maxCode || 0) === 0 && (maxRun || 0) === 0 && (maxResp || 0) === 0) {
    return null;
  }

  const [local, setLocal] = useState({
    codeScore: codeScore ?? '',
    runScore: runScore ?? '',
    respScore: respScore ?? '',
    codeExplain: codeExplain ?? '',
    runExplain: runExplain ?? '',
    respExplain: respExplain ?? '',
  });

  useEffect(() => {
    setLocal({
      codeScore: codeScore ?? '',
      runScore: runScore ?? '',
      respScore: respScore ?? '',
      codeExplain: codeExplain ?? '',
      runExplain: runExplain ?? '',
      respExplain: respExplain ?? '',
    });
  }, [codeScore, runScore, respScore, codeExplain, runExplain, respExplain]);

  const handleChange = (field) => (e) => {
    const value = e.target.value;
    setLocal((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    if (!onSave) return;
    onSave(qid, local);
  };

  // Build the “Components:” line using only bands that actually have points
  const components = [];
  if ((maxResp || 0) > 0) {
    const earned = respScore != null ? respScore : 0;
    components.push(`Written ${earned}/${maxResp}`);
  }
  if ((maxRun || 0) > 0) {
    const earned = runScore != null ? runScore : 0;
    components.push(`Run ${earned}/${maxRun}`);
  }
  if ((maxCode || 0) > 0) {
    const earned = codeScore != null ? codeScore : 0;
    components.push(`Code ${earned}/${maxCode}`);
  }

  return (
    <Card className="mt-2">
      <Card.Body>
        <Card.Title className="mb-1">
          Question {displayNumber} – Total:{' '}
          {((respScore || 0) + (runScore || 0) + (codeScore || 0))}/
          {(maxResp || 0) + (maxRun || 0) + (maxCode || 0)}
        </Card.Title>

        {components.length > 0 && (
          <Card.Subtitle className="mb-2 text-muted">
            Components: {components.join(' · ')}
          </Card.Subtitle>
        )}

        {/* WRITTEN / RESPONSE BAND */}
        {(maxResp || 0) > 0 && (
          <div className="mb-2">
            <strong>Written feedback:</strong>
            {allowEdit ? (
              <>
                <div className="d-flex align-items-center mt-1">
                  <Form.Label className="me-2 mb-0">Score</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    style={{ width: '80px' }}
                    value={local.respScore}
                    onChange={handleChange('respScore')}
                    min={0}
                    max={maxResp}
                  />
                  <span className="ms-1">/ {maxResp}</span>
                </div>
                <Form.Control
                  as="textarea"
                  rows={2}
                  className="mt-1"
                  placeholder="Short explanation (optional)"
                  value={local.respExplain}
                  onChange={handleChange('respExplain')}
                />
              </>
            ) : (
              <p className="mb-0 mt-1">
                {respExplain?.trim()
                  ? respExplain
                  : respScore === maxResp
                  ? 'Full credit for written response.'
                  : ''}
              </p>
            )}
          </div>
        )}

        {/* RUN / OUTPUT BAND – only if maxRun > 0 */}
        {(maxRun || 0) > 0 && (
          <div className="mb-2">
            <strong>Run/output feedback:</strong>
            {allowEdit ? (
              <>
                <div className="d-flex align-items-center mt-1">
                  <Form.Label className="me-2 mb-0">Score</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    style={{ width: '80px' }}
                    value={local.runScore}
                    onChange={handleChange('runScore')}
                    min={0}
                    max={maxRun}
                  />
                  <span className="ms-1">/ {maxRun}</span>
                </div>
                <Form.Control
                  as="textarea"
                  rows={2}
                  className="mt-1"
                  placeholder="Short explanation (optional)"
                  value={local.runExplain}
                  onChange={handleChange('runExplain')}
                />
              </>
            ) : (
              <p className="mb-0 mt-1">
                {runExplain?.trim()
                  ? runExplain
                  : runScore === maxRun && maxRun > 0
                  ? 'Full credit for run/output.'
                  : ''}
              </p>
            )}
          </div>
        )}

        {/* CODE BAND – only if maxCode > 0 */}
        {(maxCode || 0) > 0 && (
          <div className="mb-2">
            <strong>Code feedback:</strong>
            {allowEdit ? (
              <>
                <div className="d-flex align-items-center mt-1">
                  <Form.Label className="me-2 mb-0">Score</Form.Label>
                  <Form.Control
                    type="number"
                    size="sm"
                    style={{ width: '80px' }}
                    value={local.codeScore}
                    onChange={handleChange('codeScore')}
                    min={0}
                    max={maxCode}
                  />
                  <span className="ms-1">/ {maxCode}</span>
                </div>
                <Form.Control
                  as="textarea"
                  rows={2}
                  className="mt-1"
                  placeholder="Short explanation (optional)"
                  value={local.codeExplain}
                  onChange={handleChange('codeExplain')}
                />
              </>
            ) : (
              <p className="mb-0 mt-1">
                {codeExplain?.trim()
                  ? codeExplain
                  : codeScore === maxCode && maxCode > 0
                  ? 'Full credit for code.'
                  : ''}
              </p>
            )}
          </div>
        )}

        {allowEdit && (
          <div className="mt-2">
            <Button size="sm" variant="primary" onClick={handleSave}>
              Save scores &amp; feedback
            </Button>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
