import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Card, Spinner, Alert, Button, Row, Col, Form } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { FaUserCheck, FaLaptop } from 'react-icons/fa';

export default function ViewGroupsPage() {
  const { courseId, activityId } = useParams();
  const location = useLocation();
  const incomingCourseName = location.state && location.state.courseName;
  const [activityTitle, setActivityTitle] = useState('');
  const navigate = useNavigate();
  const [courseName, setCourseName] = useState(incomingCourseName || '');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Live-edit state
  const [available, setAvailable] = useState([]);
  const [active, setActive] = useState([]);
  const [selectedAdd, setSelectedAdd] = useState('');
  const [selectedRemove, setSelectedRemove] = useState('');

  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}`);
        const data = await res.json();

        if (!Array.isArray(data.groups)) throw new Error('Bad response format');

        setCourseName(data.courseName || incomingCourseName || '');
        setActivityTitle(data.activityTitle || '');
        setGroups(data.groups);
      } catch (err) {
        console.error('❌ Error loading groups:', err);
        setError('Could not load groups.');
      } finally {
        setLoading(false);
      }
    };

    if (courseId && activityId) fetchGroups();
  }, [courseId, activityId]);

  const refreshStudents = async () => {
    try {
      const [a, b] = await Promise.all([
        fetch(`${API_BASE_URL}/api/groups/${activityId}/${courseId}/available-students`).then((r) => r.json()),
        fetch(`${API_BASE_URL}/api/groups/${activityId}/${courseId}/active-students`).then((r) => r.json()),
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

  const handleAdd = async () => {
    if (!selectedAdd) return;
    try {
      await fetch(`${API_BASE_URL}/api/groups/${activityId}/${courseId}/smart-add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: Number(selectedAdd) }),
      });
      setSelectedAdd('');
      await refreshStudents();
      // refresh main groups list
      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}`);
        const data = await res.json();
        setGroups(Array.isArray(data.groups) ? data.groups : []);
      } catch { }
    } catch (err) {
      console.error('❌ Error adding student:', err);
      alert('Failed to add student');
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
      await fetch(`${API_BASE_URL}/api/groups/${activityInstanceId}/remove/${studentId}`, { method: 'DELETE' });
      setSelectedRemove('');
      await refreshStudents();
      // refresh main groups list
      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}`);
        const data = await res.json();
        setGroups(Array.isArray(data.groups) ? data.groups : []);
      } catch { }
    } catch (err) {
      console.error('❌ Error removing student:', err);
      alert('Failed to remove student');
    }
  };

  return (
    <Container className="mt-4">
      <h2>{activityTitle ? `Activity: ${activityTitle}` : 'Groups for Activity'}</h2>
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
        <Button onClick={handleAdd} disabled={!selectedAdd}>
          Add
        </Button>

        <Form.Select
          value={selectedRemove}
          onChange={(e) => setSelectedRemove(e.target.value)}
          style={{ maxWidth: 380 }}
        >
          <option value="">Remove student...</option>
          {active.map((s) => (
            <option key={`${s.activity_instance_id}:${s.id}`} value={`${s.activity_instance_id}:${s.id}`}>
              G{s.group_number} — {s.name} ({s.role})
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
          {groups.map((group) => (
            <Col lg={4} md={6} sm={12} key={group.instance_id}>
              <Card className="mb-3">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <div>
                    Group {group.group_number} —{' '}
                    <strong className="ms-2">
                      {group.progress === 'Complete' ? '✅ Activity Complete' : `Question Group: ${group.progress}`}
                    </strong>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      navigate(`/run/${group.instance_id}`, {
                        state: { courseName },
                      })
                    }
                  >
                    View Activity
                  </Button>
                </Card.Header>

                <Card.Body>
                  <ul>
                    {group.members.map((m, i) => (
                      <li key={i}>
                        {m.name} <span className="text-muted">&lt;{m.email}&gt;</span>
                        {group.active_student_id === m.student_id && (
                          <FaUserCheck title="Active student" className="text-success ms-1" />
                        )}
                        {m.connected && <FaLaptop title="Connected" className="text-info ms-1" />}
                        <span className="ms-2 text-muted">({m.role})</span>
                      </li>
                    ))}
                  </ul>
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Container>
  );
}
