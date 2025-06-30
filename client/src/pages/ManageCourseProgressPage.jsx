import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Button, Container } from 'react-bootstrap';
import { API_BASE_URL } from '../config';
import { useUser } from '../context/UserContext';
import { CheckCircleFill } from 'react-bootstrap-icons';

const statusColor = {
  complete: "green",
  in_progress: "orange",
  not_started: "lightgray"
};

export default function ManageCourseProgressPage() {
  const { courseId } = useParams();
  const { user } = useUser();
  const [students, setStudents] = useState([]);
  const [activities, setActivities] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/courses/${courseId}/progress`)
      .then(res => res.json())
      .then(data => {
        setStudents(data.students);
        setActivities(data.activities);
      })
      .catch(err => console.error("Failed to load progress:", err));
  }, [courseId]);

  return (
    <Container className="mt-4">
      <h3>Student Progress</h3>
      <Table bordered>
        <thead>
          <tr>
            <th>Name</th>
            {activities.map(a => (
              <th key={a.id}>{a.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map(s => (
            <tr key={s.id}>
              <td>{s.name}</td>
              {activities.map(a => {
                const status = s.progress[a.id];
                return (
                  <td key={a.id} style={{ textAlign: 'center' }}>
                    {status !== "not_started" && (
                      <CheckCircleFill color={statusColor[status]} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
      <Button onClick={() => navigate(-1)}>Back</Button>
    </Container>
  );
}


