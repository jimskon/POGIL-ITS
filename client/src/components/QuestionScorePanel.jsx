// client/src/components/QuestionScorePanel.jsx
import React, { useEffect, useState } from 'react';
import { Button, Form } from 'react-bootstrap';

/**
 * Per-question test scores + feedback panel.
 *
 * Props:
 * - qid: string, e.g. "1a" or "1"
 * - displayNumber: number, e.g. 1, 2, 3 (for "Question 1")
 * - scores: {
 *     hasAnyScore, codeScore, runScore, respScore,
 *     codeExplain, runExplain, respExplain,
 *     maxCode, maxRun, maxResp, earnedTotal, maxTotal
 *   }
 * - allowEdit: boolean — can this user edit (instructor + submitted test)?
 * - onSave(qid, updated): callback to persist edits
 */
export default function QuestionScorePanel({
  qid,
  displayNumber,
  scores,
  allowEdit,
  onSave,
}) {
  const {
    hasAnyScore,
    codeScore,
    runScore,
    respScore,
    codeExplain,
    runExplain,
    respExplain,
    maxCode,
    maxRun,
    maxResp,
    earnedTotal,
    maxTotal,
  } = scores || {};

  // Local editable state
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState({
    respScore: respScore ?? '',
    runScore: runScore ?? '',
    codeScore: codeScore ?? '',
    respExplain: respExplain ?? '',
    runExplain: runExplain ?? '',
    codeExplain: codeExplain ?? '',
  });

  // Keep local state in sync when scores change from outside
  useEffect(() => {
    setLocal({
      respScore: respScore ?? '',
      runScore: runScore ?? '',
      codeScore: codeScore ?? '',
      respExplain: respExplain ?? '',
      runExplain: runExplain ?? '',
      codeExplain: codeExplain ?? '',
    });
  }, [qid, respScore, runScore, codeScore, respExplain, runExplain, codeExplain]);

  const handleChange = (field, value) => {
    setLocal((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    if (typeof onSave === 'function') {
      onSave(qid, local);
    }
    setEditing(false);
  };

  // Fallbacks
  const safeEarned = Number.isFinite(earnedTotal) ? earnedTotal : 0;
  const safeMax = Number.isFinite(maxTotal) ? maxTotal : 0;
  const totalSummary =
    safeMax > 0 ? `${safeEarned}/${safeMax}` : `${safeEarned}`;

  const wEarn = Number.isFinite(respScore) ? respScore : 0;
  const rEarn = Number.isFinite(runScore) ? runScore : 0;
  const cEarn = Number.isFinite(codeScore) ? codeScore : 0;

  const wBand =
    maxResp > 0
      ? `Written ${wEarn}/${maxResp}`
      : respScore != null
      ? `Written ${wEarn}`
      : null;

  const rBand =
    maxRun > 0
      ? `Run ${rEarn}/${maxRun}`
      : runScore != null
      ? `Run ${rEarn}`
      : null;

  const cBand =
    maxCode > 0
      ? `Code ${cEarn}/${maxCode}`
      : codeScore != null
      ? `Code ${cEarn}`
      : null;

  const bandSummary = [wBand, rBand, cBand].filter(Boolean).join(' · ');

  // If there are literally no scores AND we’re not editing,
  // we can show nothing to students to avoid clutter.
  const showReadOnly =
    hasAnyScore ||
    respExplain ||
    runExplain ||
    codeExplain ||
    editing ||
    allowEdit;

  if (!showReadOnly) return null;

  return (
    <div className="mt-2 p-2 border rounded bg-light">
      <div>
        <strong>Question {displayNumber} – Total: </strong>
        {totalSummary}
      </div>

      {bandSummary && (
        <div className="small">
          <strong>Components:</strong>{' '}
          <span style={{ whiteSpace: 'pre-wrap' }}>{bandSummary}</span>
        </div>
      )}

      {!editing && (
        <>
          {respExplain && (
            <div className="mt-1 small">
              <strong>Written feedback:</strong>{' '}
              <span style={{ whiteSpace: 'pre-wrap' }}>{respExplain}</span>
            </div>
          )}

          {runExplain && (
            <div className="mt-1 small">
              <strong>Run/output feedback:</strong>{' '}
              <span style={{ whiteSpace: 'pre-wrap' }}>{runExplain}</span>
            </div>
          )}

          {codeExplain && (
            <div className="mt-1 small">
              <strong>Code feedback:</strong>{' '}
              <span style={{ whiteSpace: 'pre-wrap' }}>{codeExplain}</span>
            </div>
          )}
        </>
      )}

      {allowEdit && (
        <div className="mt-2">
          {!editing && (
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setEditing(true)}
            >
              Edit scores & feedback
            </Button>
          )}

          {editing && (
            <div className="mt-2">
              <Form>
                <div className="d-flex flex-wrap gap-2">
                  <Form.Group style={{ maxWidth: '120px' }}>
                    <Form.Label className="small mb-0">Written score</Form.Label>
                    <Form.Control
                      size="sm"
                      type="number"
                      value={local.respScore}
                      onChange={(e) =>
                        handleChange('respScore', e.target.value)
                      }
                    />
                  </Form.Group>

                  <Form.Group style={{ maxWidth: '120px' }}>
                    <Form.Label className="small mb-0">Run score</Form.Label>
                    <Form.Control
                      size="sm"
                      type="number"
                      value={local.runScore}
                      onChange={(e) =>
                        handleChange('runScore', e.target.value)
                      }
                    />
                  </Form.Group>

                  <Form.Group style={{ maxWidth: '120px' }}>
                    <Form.Label className="small mb-0">Code score</Form.Label>
                    <Form.Control
                      size="sm"
                      type="number"
                      value={local.codeScore}
                      onChange={(e) =>
                        handleChange('codeScore', e.target.value)
                      }
                    />
                  </Form.Group>
                </div>

                <Form.Group className="mt-2">
                  <Form.Label className="small mb-0">
                    Written feedback
                  </Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    size="sm"
                    value={local.respExplain}
                    onChange={(e) =>
                      handleChange('respExplain', e.target.value)
                    }
                  />
                </Form.Group>

                <Form.Group className="mt-2">
                  <Form.Label className="small mb-0">
                    Run/output feedback
                  </Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    size="sm"
                    value={local.runExplain}
                    onChange={(e) =>
                      handleChange('runExplain', e.target.value)
                    }
                  />
                </Form.Group>

                <Form.Group className="mt-2">
                  <Form.Label className="small mb-0">
                    Code feedback
                  </Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    size="sm"
                    value={local.codeExplain}
                    onChange={(e) =>
                      handleChange('codeExplain', e.target.value)
                    }
                  />
                </Form.Group>

                <div className="mt-2 d-flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                  >
                    Save
                  </Button>
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </Form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
