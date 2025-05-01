// src/pages/InstructorGroupSetupPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Form, Button, Alert } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

export default function InstructorGroupSetupPage() {
  const { instanceId } = useParams();
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    const loadInstance = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
        const data = await res.json();
        setCourseId(data.course_id);
      } catch (err) {
        setError('Failed to load instance');
      }
    };
    loadInstance();
  }, [instanceId]);

  useEffect(() => {
    if (!courseId) return;
    fetch(`${API_BASE_URL}/api/courses/${courseId}/enrollments`)
      .then(res => res.json())
      .then(data => {
        setStudents(data);
        setSelected(new Set(data.map(s => s.id)));
      })
      .catch(() => setError('Failed to load students'));
  }, [courseId]);

  const toggleStudent = (id) => {
    setSelected(prev => {
      const newSet = new Set(prev);
      newSet.has(id) ? newSet.delete(id) : newSet.add(id);
      return newSet;
    });
  };

  const handleSubmit = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/setup-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: Array.from(selected) })
      });
      if (!res.ok) throw new Error('Group setup failed');
      const data = await res.json();
      console.log('✅ Groups created:', data);
      navigate(`/run/${instanceId}`);
    } catch (err) {
      setError('Failed to set up groups');
    }
  };

  if (error) return <Alert variant="danger">{error}</Alert>;

  return (
    <Container className="mt-4">
      <h2>Select Present Students</h2>
      <Form>
        <Row>
          {students.map(s => (
            <Col md={6} key={s.id} className="mb-2">
              <Form.Check
                type="checkbox"
                label={s.name}
                checked={selected.has(s.id)}
                onChange={() => toggleStudent(s.id)}
              />
            </Col>
          ))}
        </Row>
        <Button variant="primary" className="mt-3" onClick={handleSubmit}>
          Generate Groups
        </Button>
      </Form>
    </Container>
  );
}
