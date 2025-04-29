import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Button, Form, Container, Row, Col } from 'react-bootstrap';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';

export default function ManageCoursesPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [newCourse, setNewCourse] = useState({
    name: '',
    code: '',
    section: '',
    semester: 'fall',
    year: new Date().getFullYear(),
    class_id: ''
  });
  const [classList, setClassList] = useState([]);

  const canManage = user?.role === 'root' || user?.role === 'creator';

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/classes`)
      .then(res => res.json())
      .then((rows) => setClassList(rows))
      .catch(err => console.error("Failed to fetch classes:", err));
  }, []);

  useEffect(() => {
    if (!canManage) navigate('/dashboard');
    else fetchCourses();
  }, []);

  const fetchCourses = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/courses`);
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        console.error("❌ Expected array but got:", data);
        setCourses([]); // fallback
      } else {
        setCourses(data);
      }
    } catch (err) {
      console.error("❌ Failed to fetch courses:", err);
      setCourses([]);
    }
  };

  const handleChange = (field, value) => {
    setNewCourse((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddCourse = async () => {
    const body = { ...newCourse, instructor_id: user.id };
    await fetch(`${API_BASE_URL}/api/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    setNewCourse({ name: '', code: '', section: '', semester: 'fall', year: new Date().getFullYear(), class_id: '' });
    fetchCourses();
  };

  const handleDelete = async (id) => {
    await fetch(`${API_BASE_URL}/api/courses/${id}`, { method: 'DELETE' });
    fetchCourses();
  };

  return (
    <Container className="mt-4">
      <h2>Manage Courses</h2>

      <Table striped bordered hover>
        <thead>
          <tr>
            <th>Name</th>
            <th>Code</th>
            <th>Section</th>
            <th>Semester</th>
            <th>Year</th>
            <th>Instructor</th>
            <th>Class</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => (
            <tr key={course.id}>
              <td>{course.name}</td>
              <td>{course.code}</td>
              <td>{course.section}</td>
              <td>{course.semester}</td>
              <td>{course.year}</td>
              <td>{course.instructor_id}</td>
              <td>{course.class_name || '—'}</td>
              <td>
                <Button size="sm" variant="danger" onClick={() => handleDelete(course.id)}>Delete</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <h4 className="mt-4">Add New Course</h4>
      <Form className="mb-3">
        <Row>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Name</Form.Label>
              <Form.Control value={newCourse.name} onChange={(e) => handleChange('name', e.target.value)} />
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>Code</Form.Label>
              <Form.Control value={newCourse.code} onChange={(e) => handleChange('code', e.target.value)} />
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>Section</Form.Label>
              <Form.Control value={newCourse.section} onChange={(e) => handleChange('section', e.target.value)} />
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>Semester</Form.Label>
              <Form.Select value={newCourse.semester} onChange={(e) => handleChange('semester', e.target.value)}>
                <option value="fall">Fall</option>
                <option value="spring">Spring</option>
                <option value="summer">Summer</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>Year</Form.Label>
              <Form.Control
                type="number"
                value={newCourse.year}
                onChange={(e) => handleChange('year', parseInt(e.target.value))}
              />
            </Form.Group>
          </Col>
        </Row>
        <Row className="mt-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Class</Form.Label>
              <Form.Select
                value={newCourse.class_id}
                onChange={(e) => handleChange('class_id', parseInt(e.target.value))}
              >
                <option value="">Select a class</option>
                {classList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>
        <Button className="mt-3" onClick={handleAddCourse}>Add Course</Button>
      </Form>
    </Container>
  );
}
