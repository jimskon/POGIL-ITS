// Updated RunActivityPage.jsx with access logic and role checks
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { parseSheetHTML } from '../utils/parseSheet';
import { Container, Form, Button, Row, Col, Alert } from 'react-bootstrap';
import axios from 'axios';


export default function RunActivityPage() {
  const { instanceId } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
    console.log("👤 User from context:", user);
    
  const [courseId, setCourseId] = useState('');
  const [activityName, setActivityName] = useState('');
  const [activityContent, setActivityContent] = useState([]);
  const [students, setStudents] = useState([]);
  const [groupLoaded, setGroupLoaded] = useState(false);
  const [roleAccess, setRoleAccess] = useState(false);
  const [isReadonly, setIsReadonly] = useState(false);
  const [error, setError] = useState('');
  const [groupId, setGroupId] = useState(null);
  const [activeStudentId, setActiveStudentId] = useState(null); 
  const [isActiveStudent, setIsActiveStudent] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [responses, setResponses] = useState({});
  const [currentAnswer, setCurrentAnswer] = useState('');


  const hasRolesTag = Array.isArray(activityContent) && activityContent.some(line => line.tag === 'roles');

useEffect(() => {
  if (!groupId) return;
  const interval = setInterval(async () => {
      const sheetRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/preview-doc`);
      const data = await sheetRes.json();
      setActivityContent(data.lines || []);



    setActiveStudentId(data.activeStudentId);
  }, 10000); // every 10s

  return () => clearInterval(interval);
}, [groupId, instanceId]);

useEffect(() => {
  if (!user?.id || !instanceId || !groupId) return;

  const interval = setInterval(() => {
    fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, groupId })
    }).catch(err => console.error("❌ Heartbeat failed:", err));
  }, 30000); // every 30s

  return () => clearInterval(interval);
}, [user?.id, instanceId, groupId]);

useEffect(() => { 
  if (!user?.id || !instanceId) return;

  const interval = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/group/${groupId}/active-student`);
      const data = await res.json();
      setActiveStudentId(data.activeStudentId);
      setIsActiveStudent(data.activeStudentId === user.id);
    } catch (err) {
      console.error("❌ Failed to fetch active student:", err);
    }
  }, 30000); // every 30 seconds

  return () => clearInterval(interval);
}, [user?.id, instanceId, groupId]);

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
  if (!groupId) return;
  const interval = setInterval(async () => {
    const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`);
    const data = await res.json();
    setActiveStudentId(data.activeStudentId);
  }, 10000); // every 10s

  return () => clearInterval(interval);
}, [groupId, instanceId]);

useEffect(() => {
    if (!courseId || !activityName || !user) return;

    const fetchData = async () => {
      try {
        // 1. Load group roles
const groupRes = await fetch(`${API_BASE_URL}/api/groups/instance/${instanceId}`);
const groupData = await groupRes.json();
setGroupLoaded(true);

 // Find the student's group
if (groupData.groups && Array.isArray(groupData.groups)) {
  for (const group of groupData.groups) {
    const found = group.members.find(m => m.student_id === user.id);
    if (found) {
      console.log("💓 Found groupId:", group.group_id);
      setGroupId(group.group_id);
      break;
    }
  }
} else {
  // For instructor/root, just use first group ID if present
  if (groupData.groups.length > 0) {
    setGroupId(groupData.groups[0].group_id);
  }
}
	  
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
	  const data = await sheetRes.json();
	  console.log("✅ Parsed lines:", data.lines);
	  setActivityContent(data.lines || []);

      } catch (err) {
        console.error('❌ Failed to load full activity data', err);
        setError('Failed to load activity data.');
      }
    };

    fetchData();
  }, [courseId, activityName, user, instanceId]);



  if (error) return <Alert variant="danger">{error}</Alert>;
  if (!groupLoaded) return <p>Loading activity...</p>;
  const isActive = user.id === activeStudentId;

  const handleSubmit = async (e) => {
    e.preventDefault();
  
    const questionBlock = activityContent.filter(b => b.type === 'question')[currentQuestionIndex];
    const responsePayload = {
      instanceId,
      groupId,
      questionId: questionBlock.id,
      responseText: currentAnswer,
      answeredBy: user.id,
    };
  
    try {
      await axios.post(`${API_BASE_URL}/api/responses`, responsePayload);
  
      setResponses({ ...responses, [questionBlock.id]: currentAnswer });
      setCurrentAnswer('');
      setCurrentQuestionIndex(prev => prev + 1);
  
      // Backend rotation will occur as part of response handler
      await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/rotate-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      });
  
      await fetchActiveStudent(); // refresh active user
  
    } catch (err) {
      console.error('❌ Error submitting response:', err);
    }
  };

  return (
    <Container className="mt-4">
      <h2>Run Activity: {activityName}</h2>

      {!roleAccess && (
        <Alert variant="warning">
          You are not authorized to view this activity. Please wait for roles to be assigned.
        </Alert>
      )}

{roleAccess && (
  <div className="mt-4">
    {!isReadonly && (
      isActive ? (
        <Alert variant="success">
          ✅ You are the active student. You may submit responses.
        </Alert>
      ) : (
        <Alert variant="info">
          ⏳ You are currently observing. The active student is submitting.
        </Alert>
      )
    )}

    {/* Display first info block */}
    {activityContent.find(b => b.type === 'info') && (
      <div className="mb-4">
        <h5>Introduction</h5>
        <div
          dangerouslySetInnerHTML={{
            __html: activityContent.find(b => b.type === 'info').content
          }}
        />
      </div>
    )}

    {/* Display first question block */}
{/* Display content up to current question index */}
{activityContent
  .slice(0, activityContent.findIndex((b, i) => {
    const questionCount = activityContent.slice(0, i + 1).filter(b => b.type === 'question').length;
    return questionCount > currentQuestionIndex;
  }) + 1)
  .map((block, idx) => {
    if (block.type === 'info') {
      return (
        <div key={idx} className="mb-3" dangerouslySetInnerHTML={{ __html: block.content }} />
      );
    }

    if (block.type === 'question') {
      const questionIndex = activityContent
        .slice(0, idx + 1)
        .filter(b => b.type === 'question')
        .length - 1;

      return (
        <div key={block.id} className="mb-4">
          <h5>Question {questionIndex + 1}</h5>
          <div dangerouslySetInnerHTML={{ __html: block.content }} />

          {questionIndex === currentQuestionIndex ? (
            isActive ? (
              <Form onSubmit={handleSubmit}>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={currentAnswer}
                  onChange={(e) => setCurrentAnswer(e.target.value)}
                  placeholder="Type your answer..."
                  className="my-2"
                />
                <Button variant="primary" type="submit">Submit Response</Button>
              </Form>
            ) : (
              <p className="text-muted"><i>Waiting for your turn...</i></p>
            )
          ) : (
            <div className="mt-2">
              <strong>Answer:</strong> {responses[block.id] || <i>(Submitted)</i>}
            </div>
          )}
        </div>
      );
    }

    return null;
  })}

      </div>
    )}

    </Container>
  );
}
