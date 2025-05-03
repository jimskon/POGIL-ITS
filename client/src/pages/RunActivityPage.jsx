// Updated RunActivityPage.jsx to use parseSheet with group-based rendering
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { Container, Button, Alert } from 'react-bootstrap';
import { parseSheetToBlocks } from '../utils/parseSheet.jsx';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';
import axios from 'axios';


export default function RunActivityPage() {
  const { instanceId } = useParams();
  const { user } = useUser();

  const [courseId, setCourseId] = useState('');
  const [activityName, setActivityName] = useState('');
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState(null);
  const [students, setStudents] = useState([]);
  const [activeStudentId, setActiveStudentId] = useState(null);
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const [groupMembers, setGroupMembers] = useState([]);
  const [responses, setResponses] = useState({});

  const isActive = user.id === activeStudentId || (
    groupMembers.length === 1 && groupMembers[0]?.student_id === user.id
  );

  useEffect(() => {
    Prism.highlightAll();
  }, [groups]);

  useEffect(() => {
    async function loadActivity() {
      try {
        const instanceRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
        const instanceData = await instanceRes.json();
        setCourseId(instanceData.course_id);
        setActivityName(instanceData.activity_name);

        const groupRes = await fetch(`${API_BASE_URL}/api/groups/instance/${instanceId}`);
        const groupData = await groupRes.json();
        const userGroup = groupData.groups.find(g => g.members.some(m => m.student_id === user.id));
        if (userGroup) {
          setGroupId(userGroup.group_id);
          setGroupMembers(userGroup.members);
        }

        const studentRes = await fetch(`${API_BASE_URL}/api/courses/${instanceData.course_id}/enrollments`);
        const studentData = await studentRes.json();
        setStudents(studentData);

        const sheetRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/preview-doc`);
        const { lines } = await sheetRes.json();
        const blocks = parseSheetToBlocks(lines);

        const grouped = [];
        let currentGroup = null;
        for (let block of blocks) {
          if (block.type === 'groupIntro') {
            if (currentGroup) grouped.push(currentGroup);
            currentGroup = { intro: block, questions: [] };
          } else if (block.type === 'question') {
            currentGroup?.questions.push(block);
          } else {
            if (currentGroup && currentGroup.intro) {
              currentGroup.intro.content += ` ${block.content || ''}`;
            }
            
          }
        }
        if (currentGroup) grouped.push(currentGroup);
        setGroups(grouped);

      } catch (err) {
        console.error('❌ Error loading activity data', err);
      }
    }
    loadActivity();
  }, [instanceId, user.id]);

  useEffect(() => {
    async function fetchActive() {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`);
      const data = await res.json();
      setActiveStudentId(data.activeStudentId);
    }
    fetchActive();
    const interval = setInterval(fetchActive, 10000);
    return () => clearInterval(interval);
  }, [instanceId]);

  useEffect(() => {
    const heartbeat = setInterval(() => {
      if (!groupId) return;
      fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, groupId })
      });
    }, 30000);
    return () => clearInterval(heartbeat);
  }, [user.id, groupId, instanceId]);

  const handleSave = async () => {
    const responsePayload = Object.entries(responses).map(([questionId, text]) => ({
      instanceId,
      groupId,
      questionId,
      responseText: text,
      answeredBy: user.id
    }));
    try {
      await Promise.all(responsePayload.map(payload =>
        axios.post(`${API_BASE_URL}/api/responses`, payload)
      ));
      await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/rotate-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId })
      });
      setCurrentGroupIndex(prev => prev + 1);
    } catch (err) {
      console.error('❌ Failed to submit group responses', err);
    }
  };

  const currentGroup = groups[currentGroupIndex];
  if (!currentGroup) return <Container><Alert variant="info">🎉 Activity complete!</Alert></Container>;

  return (
    <Container className="mt-4">
      <h2>Run Activity: {activityName}</h2>
      {isActive ? (
        <Alert variant="success">✅ You are the active student. You may submit responses.</Alert>
      ) : (
        <Alert variant="info">⏳ You are currently observing. The active student is submitting.</Alert>
      )}

      <p><strong>{currentGroup.intro.groupId}.</strong> {currentGroup.intro.content}</p>

      {currentGroup.questions.map(q => (
        <div key={q.id} className="mb-4">
          <p><strong>{q.label}</strong> {q.prompt}</p>
          {isActive ? (
            <Form.Control
              as="textarea"
              rows={q.responseLines || 2}
              value={responses[q.id] || ''}
              onChange={(e) => setResponses(prev => ({ ...prev, [q.id]: e.target.value }))}
            />
          ) : (
            <Alert variant="light">{responses[q.id] || '(No answer yet)'}</Alert>
          )}
        </div>
      ))}

      {isActive && (
        <Button onClick={handleSave}>Submit Group</Button>
      )}
    </Container>
  );
}
