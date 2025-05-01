// GroupSetupPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Card } from 'react-bootstrap';
import { API_BASE_URL } from '../config';

export default function GroupSetupPage() {
    const { courseId, instanceId } = useParams();
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState({});
  const [groups, setGroups] = useState([]);
  console.log("🔍 courseId:", courseId, "instanceId:", instanceId);
    
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/enrolled-students`)
      .then(res => res.json())
	  .then(setStudents)
      .then(data => {
        console.log("👥 Loaded students:", data);
       setStudents(data);
       })
      .catch(err => console.error('❌ Failed to load students:', err));
  }, [instanceId]);

  const toggleSelect = (id) => {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const generateGroups = () => {
    const present = students.filter(s => selected[s.id]);
    const shuffled = [...present].sort(() => 0.5 - Math.random());
    const chunks = [];
    for (let i = 0; i < shuffled.length; i += 4) {
      const chunk = shuffled.slice(i, i + 4);
      const roles = ['facilitator', 'spokesperson', 'analyst', 'qc'];
      const members = chunk.map((s, idx) => ({ student_id: s.id, role: roles[idx] }));
      chunks.push({ members });
    }
    console.log("🧩 Generated groups:", chunks);
    setGroups(chunks);
  };

  const handleSaveGroups = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/setup-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups })
      });
      const data = await res.json();
      if (res.ok) {
        alert('✅ Groups saved successfully.');
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
                  {group.members.map((m, i) => {
                    const student = students.find(s => s.id === m.student_id);
                    return <li key={i}>{m.role}: {student?.name || 'Unknown'}</li>;
                  })}
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
