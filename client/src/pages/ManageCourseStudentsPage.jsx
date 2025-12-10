// ManageCourseProgressPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Button, Container } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';

const statusColor = {
  completed: 'green',
  in_progress: 'orange',
  not_started: 'lightgray'
};

export default function ManageCourseProgressPage() {
  const { courseId } = useParams();
  const { user } = useUser();
  const [students, setStudents] = useState([]);
  const [activities, setActivities] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/courses/${courseId}/progress`, {
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        setStudents(data.students || []);
        setActivities(data.activities || []);
      })
      .catch((err) => console.error('Failed to load progress:', err));
  }, [courseId]);

  const renderActivityCell = (student, activity) => {
    const progress = student.progress?.[activity.id];

    // No record – treat as not started
    if (!progress) {
      return (
        <td key={activity.id} style={{ textAlign: 'center', color: statusColor.not_started }}>
          —
        </td>
      );
    }

    const {
      status = 'not_started',
      completedGroups = 0,
      totalGroups = 0,
    } = progress;

    // If we know totalGroups, show n/m with coloring
    if (totalGroups > 0) {
      const n = completedGroups || 0;
      const m = totalGroups;
      const isComplete = status === 'completed' || n >= m;

      const color = isComplete
        ? statusColor.completed
        : status === 'in_progress'
        ? statusColor.in_progress
        : statusColor.not_started;

      return (
        <td key={activity.id} style={{ textAlign: 'center' }}>
          <span style={{ color, fontWeight: isComplete ? 'bold' : 'normal' }}>
            {n}/{m}
          </span>
        </td>
      );
    }

    // No totalGroups known: fall back to status text
    if (status === 'completed') {
      return (
        <td key={activity.id} style={{ textAlign: 'center', color: statusColor.completed }}>
          Done
        </td>
      );
    }

    if (status === 'in_progress') {
      return (
        <td key={activity.id} style={{ textAlign: 'center', color: statusColor.in_progress }}>
          In progress
        </td>
      );
    }

    return (
      <td key={activity.id} style={{ textAlign: 'center', color: statusColor.not_started }}>
        —
      </td>
    );
  };

  return (
    <Container className="mt-4">
      <h3>Student Progress</h3>
      <Table bordered>
        <thead>
          <tr>
            <th>Name</th>
            <th>Complete</th>
            <th>Partial</th>
            {activities.map((a) => (
              <th key={a.id}>{a.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.completeCount}</td>
              <td>{s.partialCount}</td>
              {activities.map((a) => renderActivityCell(s, a))}
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="d-flex gap-2">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Back
        </Button>
        {/* Optional: link to tests page if you’ve wired a route like /courses/:courseId/tests */}
        <Button
          variant="outline-primary"
          onClick={() => navigate(`/courses/${courseId}/tests`)}
        >
          View Test Results
        </Button>
      </div>
    </Container>
  );
}
