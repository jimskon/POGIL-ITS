// DashboardPage.jsx
import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Container, Card, Button, Alert } from 'react-bootstrap';

export default function DashboardPage({ user }) {
  const navigate = useNavigate();
  console.log("User in dashboard:", user);

  if (!user) {
    return (
      <Container className="mt-5">
        <Card className="text-center">
          <Card.Body>
            <Card.Title>Dashboard</Card.Title>
            <Card.Text>You must log in to view this page.</Card.Text>
            <Button variant="primary" onClick={() => navigate('/')}>Login</Button>
          </Card.Body>
        </Card>
      </Container>
    );
  }

  const canManage = user.role === 'root' || user.role === 'creator';

  return (
    <Container className="mt-5">
      <Card>
        <Card.Body>
          <Card.Title>Welcome, {user.name}!</Card.Title>
          <Card.Subtitle className="mb-3 text-muted">Role: {user.role}</Card.Subtitle>

          {canManage ? (
            <>
              <h5>Admin Tools</h5>
              <Button as={Link} to="/manage-classes" variant="success">
                Manage POGIL Classes
              </Button>
            </>
          ) : (
            <Alert variant="info" className="mt-3">
              You do not have permission to manage POGIL activities.
            </Alert>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
}
