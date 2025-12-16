import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Container, Table, Spinner, Alert, Button, Badge } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { formatUtcToLocal } from '../utils/time';

export default function ViewTestsPage() {
  const { courseId, activityId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const incomingCourseName = location.state && location.state.courseName;

  const [activityTitle, setActivityTitle] = useState('');
  const [courseName, setCourseName] = useState(incomingCourseName || '');
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [clearing, setClearing] = useState(new Set());
  const [regrading, setRegrading] = useState(new Set());
  const [reviewing, setReviewing] = useState(new Set());

  const fetchTests = async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}`
      );
      const data = await res.json();

      if (!Array.isArray(data.groups)) throw new Error('Bad response format');

      setCourseName(data.courseName || incomingCourseName || '');
      setActivityTitle(data.activityTitle || '');
      setTests(data.groups);
    } catch (err) {
      console.error('❌ Error loading tests:', err);
      setError('Could not load tests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!courseId || !activityId) return;
    fetchTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, activityId]);

  const clearAnswers = async (instanceId) => {
    if (!window.confirm('Clear all saved answers for this test? This cannot be undone.')) return;

    const next = new Set(clearing);
    next.add(instanceId);
    setClearing(next);

    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/responses`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');

      await fetchTests();
    } catch (e) {
      console.error('❌ Clear answers failed', e);
      alert('Failed to clear answers.');
    } finally {
      const n2 = new Set(clearing);
      n2.delete(instanceId);
      setClearing(n2);
    }
  };

  const handleReopen = async (instanceId) => {
    const minutesStr = window.prompt('Reopen test for how many minutes?', '30');
    if (!minutesStr) return;

    const minutes = Number(minutesStr);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      alert('Please enter a positive number of minutes.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ minutes }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to reopen test');

      await fetchTests();
    } catch (err) {
      console.error('❌ Reopen failed:', err);
      alert(err.message || 'Failed to reopen test.');
    }
  };

  const handleRegrade = async (instanceId) => {
    if (!window.confirm('Regrade this test using the current saved answers?')) return;

    const next = new Set(regrading);
    next.add(instanceId);
    setRegrading(next);

    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/regrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to regrade');

      await fetchTests();
    } catch (err) {
      console.error('❌ Regrade failed:', err);
      alert(err.message || 'Failed to regrade test.');
    } finally {
      const n2 = new Set(regrading);
      n2.delete(instanceId);
      setRegrading(n2);
    }
  };

  const handleMarkReviewed = async (instanceId) => {
    const next = new Set(reviewing);
    next.add(instanceId);
    setReviewing(next);

    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/mark-reviewed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to mark reviewed');

      await fetchTests();
    } catch (err) {
      console.error('❌ Mark reviewed failed:', err);
      alert(err.message || 'Failed to mark reviewed.');
    } finally {
      const n2 = new Set(reviewing);
      n2.delete(instanceId);
      setReviewing(n2);
    }
  };

  return (
    <Container className="mt-4">
      <h2>
        {activityTitle ? `Tests: ${activityTitle}` : 'Tests'}
        <Badge bg="warning" text="dark" className="ms-2">
          Test
        </Badge>
      </h2>
      {courseName && <h4 className="text-muted">{courseName}</h4>}

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : tests.length === 0 ? (
        <Alert variant="info">No test attempts found.</Alert>
      ) : (
        <Table striped bordered hover responsive className="mt-3">
          <thead>
            <tr>
              <th>Student</th>
              <th>Status</th>
              <th>Start</th>
              <th>Duration</th>
              <th>Reopen until</th>
              <th>Submitted</th>
              <th>Score</th>
              <th style={{ width: 360 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => {
              const instanceId = t.instance_id;

              const member = (t.members && t.members[0]) || {};
              const studentLabel = member.email
                ? `${member.name} <${member.email}>`
                : (member.name || '(unknown)');

              const hasTiming = !!t.test_start_at && Number(t.test_duration_minutes) > 0;
              const isSubmitted = !!t.submitted_at;
              const isGraded = !!t.graded_at;
              const isReviewed = !!t.review_complete;

              const earned = t.points_earned != null ? Number(t.points_earned) : null;
              const possible = t.points_possible != null ? Number(t.points_possible) : null;
              const hasScore = Number.isFinite(earned) && Number.isFinite(possible);

              let statusText = 'Not started';
              if (hasTiming) statusText = 'In progress';
              if (isSubmitted) statusText = 'Submitted';
              if (isGraded) statusText = 'Graded';
              if (isReviewed) statusText = 'Reviewed';

              return (
                <tr key={instanceId}>
                  <td>{studentLabel}</td>

                  <td>
                    {statusText}{' '}
                    {isReviewed ? (
                      <Badge bg="primary" className="ms-1">Reviewed</Badge>
                    ) : isGraded ? (
                      <Badge bg="info" className="ms-1">Graded</Badge>
                    ) : isSubmitted ? (
                      <Badge bg="success" className="ms-1">Submitted</Badge>
                    ) : hasTiming ? (
                      <Badge bg="secondary" className="ms-1">In progress</Badge>
                    ) : null}
                  </td>

                  <td>{t.test_start_at ? formatUtcToLocal(t.test_start_at) : '—'}</td>
                  <td>{hasTiming ? `${t.test_duration_minutes} min` : '—'}</td>
                  <td>{t.test_reopen_until ? formatUtcToLocal(t.test_reopen_until) : '—'}</td>
                  <td>{t.submitted_at ? formatUtcToLocal(t.submitted_at) : 'Not submitted'}</td>
                  <td>{hasScore ? `${earned}/${possible}` : '—'}</td>

                  <td>
                    <div className="d-flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => navigate(`/run/${instanceId}`, { state: { courseName } })}
                      >
                        View
                      </Button>

                      {hasTiming && !isSubmitted && (
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => handleReopen(instanceId)}
                        >
                          Reopen
                        </Button>
                      )}

                      {isSubmitted && (
                        <Button
                          variant="outline-warning"
                          size="sm"
                          disabled={regrading.has(instanceId)}
                          onClick={() => handleRegrade(instanceId)}
                        >
                          {regrading.has(instanceId) ? 'Regrading…' : 'Regrade'}
                        </Button>
                      )}

                      {isGraded && !isReviewed && (
                        <Button
                          variant="outline-success"
                          size="sm"
                          disabled={reviewing.has(instanceId)}
                          onClick={() => handleMarkReviewed(instanceId)}
                        >
                          {reviewing.has(instanceId) ? 'Marking…' : 'Mark Reviewed'}
                        </Button>
                      )}

                      <Button
                        variant="outline-danger"
                        size="sm"
                        disabled={clearing.has(instanceId)}
                        onClick={() => clearAnswers(instanceId)}
                      >
                        {clearing.has(instanceId) ? 'Clearing…' : 'Clear'}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Container>
  );
}
