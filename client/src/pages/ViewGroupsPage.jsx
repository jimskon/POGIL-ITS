// src/pages/ViewGroupsPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Card, Spinner, Alert, Button } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

export default function ViewGroupsPage() {
  const { courseId, activityId } = useParams();
  const navigate = useNavigate();
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

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : groups.length === 0 ? (
        <Alert variant="info">No groups available.</Alert>
      ) : (
        groups.map((group, idx) => (
          <Card key={idx} className="mb-3">
            <Card.Header>Group {group.group_number}</Card.Header>
            <Card.Body>
              <ul>
                {group.members.map((m, i) => (
                  <li key={i}>{m.role}: {m.name}</li>
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
