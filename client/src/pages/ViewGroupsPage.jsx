import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Card, Spinner, Alert, Button } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { FaUserCheck, FaLaptop } from 'react-icons/fa'; // For icons

export default function ViewGroupsPage() {
  const { courseId, activityId } = useParams();
  const navigate = useNavigate();
  const [courseName, setCourseName] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    console.log("📘 ViewGroupsPage mounted", { courseId, activityId });

    const fetchGroups = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/by-activity/${courseId}/${activityId}`);
        const data = await res.json();

        if (!Array.isArray(data.groups)) {
          throw new Error("Bad response format");
        }

        setCourseName(data.courseName || '');
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
      <h2>Groups for Activity</h2>
      {courseName && <h4 className="text-muted">{courseName}</h4>}

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : groups.length === 0 ? (
        <Alert variant="info">No groups available.</Alert>
      ) : (
        groups.map((group, idx) => (
          <Card key={idx} className="mb-3">
            <Card.Header>
              Group {group.group_number} —
              <strong className="ms-2">
                {group.progress === 'Complete' ? '✅ Complete' : `Question Group: ${group.progress}`}
              </strong>
            </Card.Header>
            <Card.Body>
              <ul>
                {group.members.map((m, i) => (
                  <li key={i}>
                    {m.name}
                    {' '}
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
              <Button
                variant="primary"
                onClick={() => navigate(`/run/${group.instance_id}`)}
              >
                View Activity
              </Button>
            </Card.Body>
          </Card>
        ))
      )}
    </Container>
  );
}