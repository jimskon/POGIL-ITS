// client/src/pages/ViewGroupsPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Container,
  Card,
  Spinner,
  Alert,
  Button,
  Row,
  Col,
  Form,
} from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { FaUserCheck, FaLaptop } from 'react-icons/fa';

function normalizeStatus(v) {
  const s = String(v ?? '').trim().toLowerCase();

  // accept BOTH spellings
  if (s === 'complete' || s === 'completed') return 'complete';

  if (s === 'inprogress' || s === 'in_progress') return 'inprogress';

  return s;
}

function progressLabelFromInstanceRow(g) {
  const status = String(g.progress_status || '').toLowerCase();

  if (status === 'completed') return 'Complete';

  const tg = Number(g.total_groups) || 0;
  const cg = Number(g.completed_groups) || 0;

  // If total_groups is missing, don't guess; show "In progress"
  if (tg <= 0) return 'In progress';

  // show next group number (1-based), clamp at tg
  const next = Math.min(cg + 1, tg);
  return `Question Group ${next} of ${tg}`;
}


function computeProgressLabelCompat(answers, totalGroups) {
  if (!answers || typeof answers !== 'object') return { isComplete: false, label: '?' };

  // --- Scheme A: legacy 1state, 2state, ...
  let completeCount = 0;
  for (let i = 1; i <= (totalGroups || 9999); i++) {
    const raw = answers?.[`${i}state`]?.response;
    const status = normalizeStatus(raw);
    if (status !== 'complete') break;
    completeCount++;
  }
  if (completeCount > 0 || answers?.['1state']) {
    if (totalGroups && completeCount >= totalGroups) return { isComplete: true, label: 'Complete' };
    return { isComplete: false, label: String(completeCount + 1) };
  }

  // --- Scheme B: any keys ending with "state" (covers groupIdstate variants)
  const stateKeys = Object.keys(answers).filter((k) => k.toLowerCase().endsWith('state'));
  const completedStates = stateKeys.filter((k) => normalizeStatus(answers?.[k]?.response) === 'complete');

  // If we have any "state" keys at all, we can give a reasonable next index:
  if (stateKeys.length) {
    const n = completedStates.length;
    if (totalGroups && n >= totalGroups) return { isComplete: true, label: 'Complete' };
    return { isComplete: false, label: String(n + 1) };
  }

  // --- Nothing usable
  return { isComplete: false, label: '?' };
}


function computeProgressFromAnswers(answers, totalGroups) {
  // answers is the object returned by /api/activity-instances/:id/responses
  // It’s keyed by responseKey, and each value looks like { response: "..." }
  let completeCount = 0;

  // Count consecutive complete states starting at 1
  for (let i = 1; i <= (totalGroups || 9999); i++) {
    const key = `${i}state`;
    const raw = answers?.[key]?.response;
    const status = normalizeStatus(raw);

    if (status !== 'complete') break;
    completeCount++;
  }

  // If we know totalGroups, we can declare completion
  if (totalGroups && completeCount >= totalGroups) {
    return { isComplete: true, label: 'Complete', currentIndex: totalGroups };
  }

  // Next group index is completeCount+1 (1-based)
  const next = completeCount + 1;
  return { isComplete: false, label: String(next), currentIndex: next };
}


export default function ViewGroupsPage() {
  const { courseId, activityId } = useParams();
  const location = useLocation();
  const incomingCourseName = location.state && location.state.courseName;
  const navigate = useNavigate();

  const [activityTitle, setActivityTitle] = useState('');
  const [courseName, setCourseName] = useState(incomingCourseName || '');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(new Set());

  // Live-edit state
  const [available, setAvailable] = useState([]);
  const [active, setActive] = useState([]);
  const [selectedAdd, setSelectedAdd] = useState('');
  const [selectedRemove, setSelectedRemove] = useState('');

  const fetchGroups = async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}`,
        { credentials: 'include' }
      );
      const data = await res.json();

      if (!Array.isArray(data.groups)) throw new Error('Bad response format');

      setCourseName(data.courseName || incomingCourseName || '');
      setActivityTitle(data.activityTitle || '');

      const enriched = await Promise.all(
        data.groups.map(async (g) => {
          // prefer backend progress if present
          const backendLabel =
            g.progress_label ?? g.progressLabel ?? (g.progress != null ? String(g.progress) : null);

          // completion from backend (do NOT recompute)
          const isCompleteBackend =
            !!g.is_complete || !!g.completed_at || !!g.submitted_at || !!g.review_ready;

          if (backendLabel) {
            return { ...g, __progressLabel: backendLabel, __isComplete: isCompleteBackend };
          }

          // fallback: compute label from answers (compat)
          try {
            const ansRes = await fetch(
              `${API_BASE_URL}/api/activity-instances/${g.instance_id}/responses`,
              { credentials: 'include' }
            );
            const answers = await ansRes.json();
            const total = Number(g.total_groups || data.totalGroups || data.total_groups || 0) || null;

            const p = computeProgressLabelCompat(answers, total);
            return {
              ...g,
              __progressLabel: p.label,
              __isComplete: isCompleteBackend || p.isComplete, // backend wins, but allow legacy to mark complete
            };
          } catch {
            return { ...g, __progressLabel: '?', __isComplete: isCompleteBackend };
          }
        })
      );

      setGroups(enriched);


    } catch (err) {
      console.error('❌ Error loading groups:', err);
      setError('Could not load groups.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!courseId || !activityId) return;
    fetchGroups();
  }, [courseId, activityId]);

  const refreshStudents = async () => {
    try {
      const [a, b] = await Promise.all([
        fetch(
          `${API_BASE_URL}/api/groups/${activityId}/${courseId}/available-students`
        ).then((r) => r.json()),
        fetch(
          `${API_BASE_URL}/api/groups/${activityId}/${courseId}/active-students`
        ).then((r) => r.json()),
      ]);
      setAvailable(a.students || []);
      setActive(b.students || []);
    } catch (err) {
      console.error('❌ Error fetching students:', err);
    }
  };

  useEffect(() => {
    if (courseId && activityId) refreshStudents();
  }, [courseId, activityId]);

  const clearGroupAnswers = async (instanceId) => {
    if (!window.confirm('Clear all saved answers for this group? This cannot be undone.')) return;
    const next = new Set(clearing);
    next.add(instanceId);
    setClearing(next);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/${instanceId}/responses`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');

      await fetchGroups();
    } catch (e) {
      console.error('❌ Clear answers failed', e);
      alert('Failed to clear answers.');
    } finally {
      const n2 = new Set(clearing);
      n2.delete(instanceId);
      setClearing(n2);
    }
  };

  const handleAddToGroup = async () => {
    if (!selectedAdd) return;
    try {
      await fetch(
        `${API_BASE_URL}/api/groups/${activityId}/${courseId}/smart-add`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: Number(selectedAdd) }),
        }
      );
      setSelectedAdd('');
      await refreshStudents();
      await fetchGroups();
    } catch (err) {
      console.error('❌ Error adding student:', err);
      alert('Failed to add student');
    }
  };

  const handleAddAsSoloGroup = async () => {
    if (!selectedAdd) return;

    if (
      !window.confirm(
        'Create a new group with this student only (group of one)?'
      )
    ) {
      return;
    }

    try {
      await fetch(
        `${API_BASE_URL}/api/groups/${activityId}/${courseId}/add-solo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: Number(selectedAdd) }),
        }
      );
      setSelectedAdd('');
      await refreshStudents();
      await fetchGroups();
    } catch (err) {
      console.error('❌ Error creating solo group:', err);
      alert('Failed to create group of one');
    }
  };

  const handleRemove = async () => {
    if (!selectedRemove) return;
    const [activityInstanceIdStr, studentIdStr] = selectedRemove.split(':');
    const activityInstanceId = Number(activityInstanceIdStr);
    const studentId = Number(studentIdStr);
    if (!activityInstanceId || !studentId) return;
    if (!window.confirm('Remove this student from the activity?')) return;

    try {
      await fetch(
        `${API_BASE_URL}/api/groups/${activityInstanceId}/remove/${studentId}`,
        {
          method: 'DELETE',
        }
      );
      setSelectedRemove('');
      await refreshStudents();
      await fetchGroups();
    } catch (err) {
      console.error('❌ Error removing student:', err);
      alert('Failed to remove student');
    }
  };

  return (
    <Container className="mt-4">
      <h2>
        {activityTitle ? `Activity: ${activityTitle}` : 'Groups for Activity'}
      </h2>
      {courseName && <h4 className="text-muted">{courseName}</h4>}

      {/* Add / Remove UI */}
      <div className="my-4 d-flex gap-3 align-items-center flex-wrap">
        <Form.Select
          value={selectedAdd}
          onChange={(e) => setSelectedAdd(e.target.value)}
          style={{ maxWidth: 320 }}
        >
          <option value="">Add student...</option>
          {available.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.email})
            </option>
          ))}
        </Form.Select>

        <div className="d-flex gap-2">
          <Button
            variant="primary"
            onClick={handleAddToGroup}
            disabled={!selectedAdd}
          >
            Add to group
          </Button>

          <Button
            variant="outline-secondary"
            onClick={handleAddAsSoloGroup}
            disabled={!selectedAdd}
          >
            Group of one
          </Button>
        </div>


        <Form.Select
          value={selectedRemove}
          onChange={(e) => setSelectedRemove(e.target.value)}
          style={{ maxWidth: 380 }}
        >
          <option value="">Remove student...</option>
          {active.map((s) => (
            <option
              key={`${s.activity_instance_id}:${s.id}`}
              value={`${s.activity_instance_id}:${s.id}`}
            >
              G{s.group_number} — {s.name}
              {s.role ? ` (${s.role})` : ''}
            </option>
          ))}
        </Form.Select>
        <Button variant="danger" onClick={handleRemove} disabled={!selectedRemove}>
          Remove
        </Button>
      </div>

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : groups.length === 0 ? (
        <Alert variant="info">No groups available.</Alert>
      ) : (
        <Row>
          {groups.map((group) => {
            const isComplete =
              !!group.is_complete ||
              !!group.completed_at ||
              !!group.submitted_at ||
              !!group.review_ready;

            return (
              <Col lg={4} md={6} sm={12} key={group.instance_id}>
                <Card className="mb-3">
                  <Card.Header className="d-flex justify-content-between align-items-center flex-wrap">
                    <div>
                      Group {group.group_number} —{' '}
                      <strong className="ms-2">
                        {progressLabelFromInstanceRow(group)}
                      </strong>
                    </div>

                    <div className="d-flex gap-2 mt-2 mt-sm-0 flex-wrap">
                      <Button
                        variant="outline-danger"
                        size="sm"
                        disabled={clearing.has(group.instance_id)}
                        onClick={() => clearGroupAnswers(group.instance_id)}
                      >
                        {clearing.has(group.instance_id) ? 'Clearing…' : 'Clear Answers'}
                      </Button>

                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() =>
                          navigate(`/run/${group.instance_id}`, {
                            state: { courseName },
                          })
                        }
                      >
                        {isComplete ? 'Review Activity' : 'View Activity'}
                      </Button>
                    </div>
                  </Card.Header>

                  <Card.Body>
                    <ul>
                      {group.members.map((m, i) => (
                        <li key={i}>
                          {m.name}{' '}
                          <span className="text-muted">&lt;{m.email}&gt;</span>
                          {group.active_student_id === m.student_id && (
                            <FaUserCheck title="Active student" className="text-success ms-1" />
                          )}
                          {m.connected && (
                            <FaLaptop title="Connected" className="text-info ms-1" />
                          )}
                          {m.role && <span className="ms-2 text-muted">({m.role})</span>}
                        </li>
                      ))}
                    </ul>
                  </Card.Body>
                </Card>
              </Col>
            );
          })}

        </Row>
      )}
    </Container>
  );
}
