// Updated RunActivityPage.jsx for one-question-at-a-time flow with Preview-style rendering
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { Container, Form, Button, Alert } from 'react-bootstrap';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet.jsx';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';
import axios from 'axios';

import ActivityQuestionBlock from '../components/activity/ActivityQuestionBlock';
import ActivityHeader from '../components/activity/ActivityHeader';
import ActivityEnvironment from '../components/activity/ActivityEnvironment';
import ActivityPythonBlock from '../components/activity/ActivityPythonBlock';

export default function RunActivityPage() {
  const { instanceId } = useParams();
  const { user } = useUser();

  const [courseId, setCourseId] = useState('');
  const [activityName, setActivityName] = useState('');
  const [blocks, setBlocks] = useState([]);
  const [groupId, setGroupId] = useState(null);
  const [students, setStudents] = useState([]);
  const [activeStudentId, setActiveStudentId] = useState(null);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [roleAccess, setRoleAccess] = useState(true);
  const [groupMembers, setGroupMembers] = useState([]);
  

  const isActive = user.id === activeStudentId || (
    groupMembers.length === 1 && groupMembers[0]?.student_id === user.id
  );
  
  useEffect(() => {
    if (blocks.length > 0) {
      Prism.highlightAll();
    }
  }, [blocks]);

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
        const parsed = Array.isArray(lines) && typeof lines[0] === 'string' ? parseSheetToBlocks(lines) : lines;
        setBlocks(parsed);
        console.log("students:", studentData, activeStudentId);
        console.log("usergroup members:",userGroup.members);
        console.log("Active:", isActive);

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
  
    fetchActive(); // ✅ immediate fetch on mount
  
    const interval = setInterval(fetchActive, 10000); // then repeat
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    const question = blocks.filter(b => b.type === 'question')[currentQuestionIndex];
    const payload = {
      instanceId,
      groupId,
      questionId: question.id,
      responseText: currentAnswer,
      answeredBy: user.id
    };
    try {
      await axios.post(`${API_BASE_URL}/api/responses`, payload);
      setCurrentAnswer('');
      setCurrentQuestionIndex(prev => prev + 1);
      await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/rotate-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId })
      });
    } catch (err) {
      console.error('❌ Failed to submit response', err);
    }
  };

  let visible = [];
  let qSeen = -1;
  for (const block of blocks) {
    if (block.type === 'question') qSeen++;
    visible.push(block);
    if (qSeen === currentQuestionIndex) break;
  }

  return (
    <Container className="mt-4">
      <h2>Run Activity: {activityName}</h2>
      {roleAccess ? (
        <>
          {isActive ? (
            <Alert variant="success">✅ You are the active student. You may submit responses.</Alert>
          ) : (
            <Alert variant="info">⏳ You are currently observing. The active student is submitting.</Alert>
          )}
          {renderBlocks(visible, currentAnswer, setCurrentAnswer, isActive, handleSubmit)}
        </>
      ) : (
        <Alert variant="warning">⛔ You are not authorized to view this activity.</Alert>
      )}
    </Container>
  );
}
