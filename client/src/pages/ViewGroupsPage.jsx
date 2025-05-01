import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Card, Spinner, Alert } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { Link } from 'react-router-dom';
import { LinkContainer } from 'react-router-bootstrap';
import { Button } from 'react-bootstrap';

export default function ViewGroupsPage() {
  const { courseId, instanceId } = useParams();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/groups/instance/${instanceId}`)
      .then(res => res.json())
      .then(data => setGroups(data.groups || []))
      .catch(err => {
        console.error("❌ Error loading groups:", err);
        setError("Could not load groups.");
      })
      .finally(() => setLoading(false));
  }, [instanceId]);

  return (
    <Container className="mt-4">
      <h2>Groups for Activity Instance {instanceId}</h2>
      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
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
		<LinkContainer to={`/run/${instanceId}`}>
                   <Button variant="primary">View Activity</Button>
                </LinkContainer>
            </Card.Body>
          </Card>
        ))
      )}
    </Container>
  );
}
