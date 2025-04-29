// src/pages/CourseActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Table, Button, Spinner } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

export default function CourseActivitiesPage() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities`);
        const data = await res.json();
        setActivities(data);
      } catch (err) {
        console.error('Failed to fetch activities', err);
        setError('Unable to load activities.');
      } finally {
        setLoading(false);
      }
    };

    fetchActivities();
  }, [classId]);

  const handleDoActivity = (activityName) => {
    navigate(`/do-activity/${classId}/${activity.name}`);
  };

  return (
    <Container className="mt-4">
      <h2>Available Activities</h2>

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <div className="text-danger mt-3">{error}</div>
      ) : activities.length === 0 ? (
        <p>No activities available for this class.</p>
      ) : (
        <Table striped bordered hover>
          <thead>
            <tr>
              <th>Activity Title</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity, idx) => (
              <tr key={idx}>
                <td>{activity.title}</td>
                <td>
                  <Button
                    variant="success"
		      onClick={() => navigate(`/do-activity/${classId}/${activity.name}`)}
                  >
                    Start
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Container>
  );
}
