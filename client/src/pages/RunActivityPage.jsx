// client/src/pages/RunActivityPage.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Alert, Button } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';

import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';

export default function RunActivityPage() {
  const { instanceId } = useParams();
  const { user } = useUser();
  const [activity, setActivity] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [activeStudentId, setActiveStudentId] = useState(null);
  const [activeStudentName, setActiveStudentName] = useState('');
  const [preamble, setPreamble] = useState([]);
  const [existingAnswers, setExistingAnswers] = useState({});
  const [skulptLoaded, setSkulptLoaded] = useState(false);

  const isActive = user && user.id === activeStudentId;

const currentQuestionGroupIndex = useMemo(() => {
  console.log("🧩 existingAnswers snapshot:", existingAnswers);

  if (!existingAnswers || Object.keys(existingAnswers).length === 0) {
    console.log("⚠️ existingAnswers not ready yet");
    return 0;
  }

  let count = 0;
  while (existingAnswers[`${count + 1}state`]?.response === 'complete') {
    console.log(`✅ Skipping group ${count + 1} as complete`);
    count++;
  }

  console.log(`✅ currentQuestionGroupIndex after skipping:`, count);
  return count;
}, [existingAnswers]);


  if (!user) {
    return (
      <Container className="mt-4">
        <Alert variant="danger">User not loaded. Please log in again.</Alert>
      </Container>
    );
  }

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`);
        const data = await res.json();
        if (data.activeStudentId !== activeStudentId) {
          await loadActivity();
        }
      } catch { }
    }, 10000);
    return () => clearInterval(interval);
  }, [instanceId, activeStudentId]);

  useEffect(() => {
    const sendHeartbeat = async () => {
      if (!user?.id || !instanceId) return;
      try {
        await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id })
        });
      } catch (err) {
        console.error('❌ Heartbeat failed:', err);
      }
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 20000);
    return () => clearInterval(interval);
  }, [user?.id, instanceId]);

  useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve(); return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script ${src}`));
        document.head.appendChild(script);
      });
    const loadSkulpt = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');
        if (window.Sk && window.Sk.builtinFiles) setSkulptLoaded(true);
      } catch (err) {
        console.error('Skulpt failed to load', err);
      }
    };
    loadSkulpt();
  }, []);

  useEffect(() => { loadActivity(); }, []);

  useEffect(() => {
    if (!activeStudentId) return;
    let student = groupMembers.find(m => String(m.student_id) === String(activeStudentId));
    if (!student) {
      fetch(`${API_BASE_URL}/api/users/${activeStudentId}`)
        .then(res => res.json())
        .then(userData => setActiveStudentName(userData.name || '(unknown)'))
        .catch(() => setActiveStudentName('(unknown)'));
    } else {
      setActiveStudentName(student.name);
    }
  }, [activeStudentId, groupMembers]);

  useEffect(() => { Prism.highlightAll(); }, [groups]);

  async function loadActivity() {
    try {
      const instanceRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
      const instanceData = await instanceRes.json();
      setActivity(instanceData);

      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`, { credentials: 'include' });
      const activeData = await res.json();
      setActiveStudentId(activeData.activeStudentId);

      const groupRes = await fetch(`${API_BASE_URL}/api/groups/instance/${instanceId}`);
      const groupData = await groupRes.json();

      const userGroup = groupData.groups.find(g => g.members.some(m => m.student_id === user.id));
      if (userGroup) {
        setGroupMembers(userGroup.members);

        const answersRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/responses`);
        const answersData = await answersRes.json();
        setExistingAnswers(answersData);
      }

      const docRes = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(instanceData.sheet_url)}`);
      const { lines } = await docRes.json();
      const blocks = parseSheetToBlocks(lines);

      const grouped = [], preamble = [];
      let currentGroup = null;
      for (let block of blocks) {
        if (block.type === 'groupIntro') {
          if (currentGroup) grouped.push(currentGroup);
          currentGroup = { intro: block, content: [] };
        } else if (block.type === 'endGroup') {
          if (currentGroup) { grouped.push(currentGroup); currentGroup = null; }
        } else if (currentGroup) {
          currentGroup.content.push(block);
        } else {
          preamble.push(block);
        }
      }
      setGroups(grouped);
      setPreamble(preamble);
    } catch (err) {
      console.error('Failed to load activity data', err);
    }
  }

  async function handleSubmit() {
    const container = document.querySelector('[data-current-group="true"]');
    if (!container) {
      alert("Error: No editable group found.");
      return;
    }
    const answerInputs = container.querySelectorAll('[data-question-id]');
    const answers = {};
    answerInputs.forEach(el => {
      const qid = el.getAttribute('data-question-id');
      const value = el.value?.trim();
      if (qid && value !== undefined) answers[qid] = value;
    });
    if (Object.keys(answers).length === 0) {
      alert("No answers found to submit.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/submit-group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupIndex: currentQuestionGroupIndex,
          studentId: user.id,
          answers
        })
      });
      if (!response.ok) {
        const errorData = await response.json();
        alert(`Submission failed: ${errorData.error || 'Unknown error'}`);
      } else {
        await loadActivity();
      }
    } catch (err) {
      console.error("❌ Submission failed:", err);
      alert("An error occurred during submission.");
    }
  }

  return (
    <Container className="mt-4">
      <h2>Run Activity: {activity?.title || activity?.name}</h2>
      {isActive
        ? <Alert variant="success">You are the active student. You may submit responses.</Alert>
        : <Alert variant="info">You are currently observing. The active student is {activeStudentName || '(unknown)'}</Alert>}

      {renderBlocks(preamble, { editable: false, isActive: false, mode: 'run' })}

      {groups.map((group, index) => {
        const stateKey = `${index + 1}state`;
        const isComplete = existingAnswers[stateKey] === 'complete';
        const isCurrent = index === currentQuestionGroupIndex;
        const isFuture = index > currentQuestionGroupIndex;
        if (isFuture) return null;
        const editable = isActive && isCurrent && !isComplete;
        return (
          <div
            key={`group-${index}`}
            className="mb-4"
            data-current-group={editable ? "true" : undefined}
          >
            <p><strong>Group {activity.group_number}.</strong> {group.intro.content}</p>
            {renderBlocks(group.content, {
              editable,
              isActive,
              mode: 'run',
              prefill: existingAnswers,
              currentGroupIndex: index
            })}
            {editable && (
              <div className="mt-2">
                <Button onClick={handleSubmit}>Submit and Continue</Button>
              </div>
            )}
          </div>
        );
      })}

      {currentQuestionGroupIndex === groups.length && (
        <Alert variant="success">All groups complete! Review your responses above.</Alert>
      )}
    </Container>
  );
}
