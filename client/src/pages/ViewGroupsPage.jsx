import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Card, Spinner, Alert, Button, Row, Col } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { FaUserCheck, FaLaptop } from 'react-icons/fa';

export default function ViewGroupsPage() {
  const { courseId, activityId } = useParams();
  const location = useLocation();
  const incomingCourseName = location.state?.courseName;
  const [activityTitle, setActivityTitle] = useState('');
  const navigate = useNavigate();
  const [courseName, setCourseName] = useState(incomingCourseName || '');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}`);
        const data = await res.json();

        if (!Array.isArray(data.groups)) throw new Error("Bad response format");

        setCourseName(data.courseName || incomingCourseName || '');
        setActivityTitle(data.activityTitle || '');
        setGroups(data.groups);
      } catch (err) {
        console.error("❌ Error loading groups:", err);
        setError("Could not load groups.");
      } finally {
        setLoading(false);
      }
    };

    fetchGroups();
  }, [courseId, activityId]);

  return (
    <Container className="mt-4">
      <h2>{activityTitle ? `Activity: ${activityTitle}` : 'Groups for Activity'}</h2>
      {courseName && <h4 className="text-muted">{courseName}</h4>}

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
                    Group {group.group_number} —
                    <strong className="ms-2">
                      {group.progress === 'Complete' ? '✅ Activity Complete' : `Question Group: ${group.progress}`}
                    </strong>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => navigate(`/run/${group.instance_id}`, {
                      state: { courseName }
                    })}
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
                        {m.connected && (
                          <FaLaptop title="Connected" className="text-info ms-1" />
                        )}
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
