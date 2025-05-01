// Updated RunActivityPage.jsx with access logic and role checks
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Form, Button, Row, Col, Alert } from 'react-bootstrap';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';

export default function RunActivityPage() {
  const { instanceId } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
    console.log("👤 User from context:", user);
    
  const [courseId, setCourseId] = useState('');
  const [activityName, setActivityName] = useState('');
  const [activityContent, setActivityContent] = useState([]);
  const [students, setStudents] = useState([]);
  const [roles, setRoles] = useState({ facilitator: '', spokesperson: '', analyst: '', qc: '' });
  const [groupLoaded, setGroupLoaded] = useState(false);
  const [roleAccess, setRoleAccess] = useState(false);
  const [isReadonly, setIsReadonly] = useState(false);
  const [error, setError] = useState('');

  const allRolesSelected = Object.values(roles).every(Boolean);

  const hasRolesTag = Array.isArray(activityContent) && activityContent.some(line => line.tag === 'roles');

  useEffect(() => {
    const loadInstance = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
        const data = await res.json();
        setCourseId(data.course_id);
        setActivityName(data.activity_name);
      } catch (err) {
        setError('Failed to load activity instance.');
      }
    };
    loadInstance();
  }, [instanceId]);

  useEffect(() => {
    if (!courseId || !activityName || !user) return;

    const fetchData = async () => {
      try {
        // 1. Load group roles
        const groupRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/group`);
        const groupData = await groupRes.json();
        setGroupLoaded(true);

        if (!groupData || !groupData.rolesAssigned) {
          setRoleAccess(true); // no roles yet → allow assignment
        } else {
          // roles exist: check if user is in group or is instructor/root
          const emails = Object.values(groupData.roles || {});
          if (emails.includes(user.email) || user.role === 'root' || groupData.instructor_id === user.id) {
            setRoleAccess(true);
            setIsReadonly(user.role !== 'student');
          }
        }

        // 2. Load students
        const studentsRes = await fetch(`${API_BASE_URL}/api/courses/${courseId}/enrollments`);
        const studentsData = await studentsRes.json();
        setStudents(studentsData);

        // 3. Load sheet content
        const sheetRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/preview-doc`);
        const sheetData = await sheetRes.json();
        setActivityContent(sheetData.lines || []);
      } catch (err) {
        console.error('❌ Failed to load full activity data', err);
        setError('Failed to load activity data.');
      }
    };

    fetchData();
  }, [courseId, activityName, user, instanceId]);

  const handleAssignRoles = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_instance_id: instanceId,
          facilitator_id: roles.facilitator,
          spokesperson_id: roles.spokesperson,
          analyst_id: roles.analyst,
          qc_id: roles.qc,
          facilitator_email: getEmail(roles.facilitator),
          spokesperson_email: getEmail(roles.spokesperson),
          analyst_email: getEmail(roles.analyst),
          qc_email: getEmail(roles.qc)
        })
      });
      if (!res.ok) {
  if (res.status === 400) {
    const errorData = await res.json();
    setError(errorData.error || 'This activity already has assigned roles.');
  } else {
    throw new Error('Failed to save roles');
  }
  return;
}
       setRoleAccess(true);
    } catch (err) {
      console.error(err);
      setError('Failed to assign roles.');
    }
  };

  const getEmail = (id) => {
    const student = students.find(s => s.id.toString() === id.toString());
    return student?.email || '';
  };

  if (error) return <Alert variant="danger">{error}</Alert>;
  if (!groupLoaded) return <p>Loading activity...</p>;

  return (
    <Container className="mt-4">
      <h2>Run Activity: {activityName}</h2>

      {!roleAccess && (
        <Alert variant="warning">
          You are not authorized to view this activity. Please wait for roles to be assigned.
        </Alert>
      )}

      {roleAccess && hasRolesTag && !isReadonly && (
        <>
          <h4>Assign Roles</h4>
          <Row>
            {Object.keys(roles).map(role => (
              <Col md={6} key={role} className="mb-3">
                <Form.Group>
                  <Form.Label>{role}</Form.Label>
                  <Form.Select
                    value={roles[role]}
                    onChange={e => setRoles(prev => ({ ...prev, [role]: e.target.value }))}
                  >
                    <option value="">-- Select Student --</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            ))}
          </Row>
          {allRolesSelected && <Button onClick={handleAssignRoles}>Start Activity</Button>}
        </>
      )}

      {roleAccess && (
        <div className="mt-4">
          {activityContent.map((line, idx) => (
            <p key={idx}>{line.text || JSON.stringify(line)}</p>
          ))}
        </div>
      )}
    </Container>
  );
}
