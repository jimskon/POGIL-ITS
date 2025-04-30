// src/pages/CourseActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Table, Button, Spinner, Alert } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

console.log("📘 CourseActivitiesPage mounted");

export default function CourseActivitiesPage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    console.log("📘 Fetching activities for courseId:", courseId);
    const fetchActivities = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/courses/${courseId}/activities`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) {
          console.error("Expected array, got:", data);
          setActivities([]);
        } else {
          setActivities(data);
        }
      } catch (err) {
        console.error('❌ Failed to fetch activities:', err);
        setError('Unable to load activities.');
      } finally {
        setLoading(false);
      }
    };

    fetchActivities();
  }, [courseId]);

  const handleDoActivity = (activityId) => {
    navigate(`/do-activity/${courseId}/${activityId}`);
  };

  return (
    <Container className="mt-4">
      <h2>Available Activities</h2>

      {loading ? (
        <Spinner animation="border" />
      ) : error ? (
        <Alert variant="danger">{error}</Alert>
      ) : activities.length === 0 ? (
        <Alert variant="info">No activities available for this course.</Alert>
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
                <td>{activity.title || activity.activity_name || 'Untitled Activity'}</td>
                <td>
                  <Button
                    variant="success"
                    onClick={() => handleDoActivity(activity.activity_id)}
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
