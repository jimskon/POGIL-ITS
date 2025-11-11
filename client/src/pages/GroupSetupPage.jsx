// GroupSetupPage.jsx

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Card } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

export default function GroupSetupPage() {
  const { courseId, activityId } = useParams();
  const navigate = useNavigate();

  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState({});
  const [groups, setGroups] = useState([]);
  const [groupSize, setGroupSize] = useState(4);      // 🔹 New: group size selector (1–5)
  const [useRoles, setUseRoles] = useState(true);     // 🔹 New: toggle role assignment

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/courses/${courseId}/students`)
      .then(res => res.json())
      .then(data => {
        const loaded = Array.isArray(data) ? data : data.students;
        setStudents(loaded || []);

        // Initialize all students with role 'student' as selected
        const defaultSelected = {};
        (loaded || []).forEach(student => {
          defaultSelected[student.id] = student.role === 'student';
        });
        setSelected(defaultSelected);
      })
      .catch(err => console.error('❌ Failed to load students:', err));
  }, [courseId, activityId]);

  const toggleSelect = (id) => {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const generateGroups = () => {
    const present = students.filter(s => selected[s.id]);
    const shuffled = [...present].sort(() => Math.random() - 0.5);

    if (shuffled.length === 0) {
      setGroups([]);
      return;
    }

    const size = Math.min(Math.max(groupSize, 1), 5); // clamp 1–5

    // Split into groups of chosen size
    const rawGroups = [];
    for (let i = 0; i < shuffled.length; i += size) {
      rawGroups.push(shuffled.slice(i, i + size));
    }

    // Keep your special merge behavior ONLY for size 4 (your previous logic)
    if (size === 4 && rawGroups.length > 0) {
      const lastGroup = rawGroups[rawGroups.length - 1];

      if (lastGroup.length === 1 && rawGroups.length >= 3) {
        const merged = rawGroups.splice(-3).flat();
        rawGroups.push(
          merged.slice(0, 3),
          merged.slice(3, 6),
          merged.slice(6)
        );
      } else if (lastGroup.length === 2 && rawGroups.length >= 2) {
        const merged = rawGroups.splice(-2).flat();
        rawGroups.push(
          merged.slice(0, 3),
          merged.slice(3)
        );
      }
    }

    const rolePriority = ['facilitator', 'analyst', 'qc', 'spokesperson'];

const finalGroups = rawGroups.map(group => {
  const gSize = group.length;

  const members = group.map((student, index) => {
    let role = null; // default: no role

    if (useRoles) {
      if (gSize < 4) {
        // Fill roles in priority order for however many students there are
        role = rolePriority[index] || null;
      } else if (gSize === 4) {
        role = rolePriority[index] || null;
      } else {
        // gSize === 5: first 4 get roles, 5th gets none
        role = index < 4 ? rolePriority[index] : null;
      }
    }

    return {
      student_id: student.id,
      role
    };
  });

  return { members };
});


    console.log('🧩 Generated groups:', finalGroups);
    setGroups(finalGroups);
  };

  const handleSaveGroups = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/setup-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId: Number(activityId),
          courseId: Number(courseId),
          groups
        })
      });

      const data = await res.json();

      if (res.ok) {
        alert('✅ Groups saved successfully.');
        navigate(`/view-groups/${courseId}/${activityId}`);
      } else {
        alert(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      console.error('❌ Save groups failed:', err);
      alert('❌ Failed to save groups.');
    }
  };

  return (
    <Container className="mt-4">
      <h2>Group Setup</h2>

      <h5>Select Present Students:</h5>
      <Row>
        {Array.isArray(students) && students.length > 0 ? (
          students.map(s => (
            <Col md={3} key={s.id} className="mb-2">
              <Form.Check
                type="checkbox"
                label={s.role === 'student' ? s.name : `${s.name} (${s.role})`}
                checked={!!selected[s.id]}
                onChange={() => toggleSelect(s.id)}
              />
            </Col>
          ))
        ) : (
          <p>No students enrolled.</p>
        )}
      </Row>

      {/* 🔹 Controls: group size + use roles */}
      <Row className="mt-3">
        <Col md={3}>
          <Form.Label>Group Size</Form.Label>
          <Form.Select
            value={groupSize}
            onChange={(e) => setGroupSize(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </Form.Select>
        </Col>
        <Col md={3} className="d-flex align-items-end">
          <Form.Check
            type="checkbox"
            id="use-roles"
            label="Assign roles to group members"
            checked={useRoles}
            onChange={(e) => setUseRoles(e.target.checked)}
          />
        </Col>
      </Row>

      <Button className="mt-3" onClick={generateGroups}>
        Generate Groups
      </Button>

      {groups.length > 0 && (
        <>
          <h5 className="mt-4">Generated Groups:</h5>
          {groups.map((group, idx) => (
            <Card key={idx} className="mb-3">
              <Card.Header>Group {idx + 1}</Card.Header>
              <Card.Body>
                <ul>
                  {Array.isArray(group.members) && group.members.length > 0 ? (
                    group.members.map((m, i) => {
                      const student = students.find(s => s.id === m.student_id);
                      const name = student?.name || 'Unknown';
                      // Show role label only if non-empty
                      return (
                        <li key={i}>
                          {m.role ? `${m.role}: ${name}` : name}
                        </li>
                      );
                    })
                  ) : (
                    <li>⚠️ No members in this group.</li>
                  )}
                </ul>
              </Card.Body>
            </Card>
          ))}
          <Button onClick={handleSaveGroups}>Save Groups</Button>
        </>
      )}
    </Container>
  );
}
