import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { Table, Button, Form, Container, Alert, Row, Col } from 'react-bootstrap';

export default function DashboardPage() {
  const { user } = useUser();
  const navigate = useNavigate();

  const [enrolledClasses, setEnrolledClasses] = useState([]);
  const [courseCode, setCourseCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!user?.id) return;

    const fetchEnrollments = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/classes/user/${user.id}/enrollments`);
        const data = await res.json();
        setEnrolledClasses(data);
      } catch (err) {
        console.error('Failed to fetch enrollments', err);
        setError('Unable to load enrolled classes');
      }
    };

    fetchEnrollments();
  }, [user?.id]);

  const handleJoinCourse = async () => {
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/classes/enroll-by-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, code: courseCode })
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess('Successfully enrolled!');
        setCourseCode('');
        setEnrolledClasses(prev => [...prev, data.newCourse]);
      } else {
        setError(data.error || 'Failed to enroll');
      }
    } catch (err) {
      console.error('Enrollment error:', err);
      setError('Failed to enroll in course');
    }
  };

  const canManage = user?.role === 'root' || user?.role === 'creator';

  return (
    <Container className="mt-4">
      <h2>Welcome, {user?.name}</h2>

      {canManage && (
        <Row className="mt-4 mb-4">
          <Col><Button variant="secondary" onClick={() => navigate('/manage-courses')}>Manage Courses</Button></Col>
          <Col><Button variant="secondary" onClick={() => navigate('/manage-classes')}>Manage Classes</Button></Col>
          {user.role === 'root' && (
            <Col><Button variant="danger" onClick={() => navigate('/admin/users')}>Manage Users</Button></Col>
          )}
        </Row>
      )}

      {user?.id && (
        <>
          {enrolledClasses.length > 0 ? (
            <>
              <h4>Your Enrolled Classes</h4>
              <Table striped bordered hover>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Code</th>
                    <th>Semester</th>
                    <th>Year</th>
                  </tr>
                </thead>
                <tbody>
                  {enrolledClasses.map(course => (
                    <tr key={course.id}>
                      <td>{course.name}</td>
                      <td>{course.code}</td>
                      <td>{course.semester}</td>
                      <td>{course.year}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          ) : (
            <p>You are not enrolled in any classes yet.</p>
          )}

          <h5 className="mt-5">Join a Class by Code</h5>
          <Form className="d-flex" onSubmit={(e) => { e.preventDefault(); handleJoinCourse(); }}>
            <Form.Control
              type="text"
              placeholder="Enter Course Code"
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
            />
            <Button className="ms-2" variant="primary" onClick={handleJoinCourse}>
              Join
            </Button>
          </Form>

          {error && <Alert variant="danger" className="mt-3">{error}</Alert>}
          {success && <Alert variant="success" className="mt-3">{success}</Alert>}
        </>
      )}
    </Container>
  );
}
