// GroupSetupPage.jsx

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom'; // ⬅️ Import useNavigate for redirection
import { Container, Row, Col, Button, Form, Card } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

export default function GroupSetupPage() {
  const { courseId, activityId } = useParams();
  const navigate = useNavigate(); // ⬅️ Initialize useNavigate
  console.log("GroupSetupPage🔍 courseId:", courseId, "activityId:", activityId);

  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState({});
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/courses/${courseId}/students`)
      .then(res => res.json())
      .then(data => {
        const loaded = Array.isArray(data) ? data : data.students;
        setStudents(loaded);

        // ✅ Initialize all as selected
        const defaultSelected = {};
        loaded.forEach(student => {
          defaultSelected[student.id] = true;
        });
        setSelected(defaultSelected);
      })
      .catch(err => console.error('❌ Failed to load students:', err));
  }, [activityId]);

  const toggleSelect = (id) => {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const generateGroups = () => {
    const present = students.filter(s => selected[s.id]);
    const shuffled = [...present].sort(() => 0.5 - Math.random());

    const groups = [];
    for (let i = 0; i < shuffled.length; i += 4) {
      groups.push(shuffled.slice(i, i + 4));
    }

    const lastGroup = groups[groups.length - 1];

    if (lastGroup.length === 1 && groups.length >= 3) {
      const merged = groups.splice(-3).flat();
      groups.push(merged.slice(0, 3), merged.slice(3, 6), merged.slice(6));
    } else if (lastGroup.length === 2 && groups.length >= 2) {
      const merged = groups.splice(-2).flat();
      groups.push(merged.slice(0, 3), merged.slice(3));
    }

    const roleNames = ['facilitator', 'spokesperson', 'analyst', 'qc'];
    const finalGroups = groups.map(group => {
      const members = [];
      if (group.length === 4) {
        group.forEach((s, i) => {
          members.push({ student_id: s.id, role: roleNames[i] });
        });
      } else if (group.length === 3) {
        members.push({ student_id: group[0].id, role: 'facilitator' });
        members.push({ student_id: group[0].id, role: 'spokesperson' });
        members.push({ student_id: group[1].id, role: 'analyst' });
        members.push({ student_id: group[2].id, role: 'qc' });
      } else if (group.length < 3) {
        const fillers = [...group];
        while (fillers.length < 4) {
          fillers.push(group[0]);
        }
        fillers.forEach((s, i) => {
          members.push({ student_id: s.id, role: roleNames[i] });
        });
      }
      return { members };
    });

    console.log("🧩 Generated groups:", finalGroups);
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
        // ✅ Redirect to the View Groups page after successful save
        navigate(`/view-groups/${courseId}/${activityId}`); // ⬅️ Added this line for redirection
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
                label={s.name}
                checked={!!selected[s.id]}
                onChange={() => toggleSelect(s.id)}
              />
            </Col>
          ))
        ) : (
          <p>No students enrolled.</p>
        )}
      </Row>

      <Button className="mt-3" onClick={generateGroups}>Generate Groups</Button>
      {groups.length > 0 && (
        <>
          <h5 className="mt-4">Generated Groups:</h5>
          {groups.map((group, idx) => (
            <Card key={idx} className="mb-3">
              <Card.Header>Group {idx + 1}</Card.Header>
              <Card.Body>
                <ul>
                  {Array.isArray(group.members) ? (
                    group.members.map((m, i) => {
                      const student = students.find(s => s.id === m.student_id);
                      return <li key={i}>{m.role}: {student?.name || 'Unknown'}</li>;
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
