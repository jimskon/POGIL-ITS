import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Alert, Button } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';

import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet.jsx';

export default function RunActivityPage() {
  const { instanceId } = useParams();
  const { user } = useUser();

  const [activity, setActivity] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [activeStudentId, setActiveStudentId] = useState(null);
  const [activeStudentName, setActiveStudentName] = useState('');
  const [preamble, setPreamble] = useState([]);
  const [existingAnswers, setExistingAnswers] = useState({});

  const isActive = user.id === activeStudentId;

  useEffect(() => {
    Prism.highlightAll();
  }, [groups]);

  useEffect(() => {
    async function loadActivity() {
      try {
        const instanceRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
        const instanceData = await instanceRes.json();

        const activityRes = await fetch(`${API_BASE_URL}/api/activities/${instanceData.activity_id}`);
        const activityData = await activityRes.json();
        setActivity(activityData);

        const groupRes = await fetch(`${API_BASE_URL}/api/groups/instance/${instanceId}`);
        const groupData = await groupRes.json();

        const userGroup = groupData.groups.find(g =>
          g.members.some(m => m.student_id === user.id)
        );

        if (userGroup) {
          setGroupId(userGroup.group_id);
          setGroupMembers(userGroup.members);

          const answersRes = await fetch(`${API_BASE_URL}/api/responses/${instanceId}/${userGroup.group_id}`);
          const answersData = await answersRes.json();
          setExistingAnswers(Object.fromEntries(
            Object.entries(answersData).map(([qid, val]) => [qid, val.response])
          ));
        }

        const docRes = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`);
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

        const activeRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`);
        const { activeStudentId } = await activeRes.json();
        setActiveStudentId(activeStudentId);
      } catch (err) {
        console.error('❌ Error loading activity data', err);
      }
    }

    loadActivity();
  }, [instanceId, user.id]);

  useEffect(() => {
    async function refreshActiveStudent() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`);
        const data = await res.json();
        setActiveStudentId(data.activeStudentId);
      } catch (err) {
        console.error("Failed to refresh active student:", err);
      }
    }

    const interval = setInterval(refreshActiveStudent, 10000);
    return () => clearInterval(interval);
  }, [instanceId]);

  useEffect(() => {
    if (!activeStudentId || groupMembers.length === 0) return;
    const student = groupMembers.find(m => String(m.student_id) === String(activeStudentId));
    setActiveStudentName(student?.name || '(unknown)');
  }, [activeStudentId, groupMembers]);

  const activeIndex = useMemo(() => {
    return groups.findIndex((_, i) => {
      const stateKey = `${i + 1}state`;
      return existingAnswers && existingAnswers[stateKey] !== 'complete';
    });
  }, [groups, existingAnswers]);

  const fallbackIndex = activeIndex === -1 ? groups.length : activeIndex;

  async function handleSubmit() {
    const answerInputs = document.querySelectorAll('[data-question-id]');
    const answers = {};
    answerInputs.forEach(el => {
      const qid = el.getAttribute('data-question-id');
      if (qid) answers[qid] = el.value;
    });

    if (Object.keys(answers).length === 0) {
      alert("⚠️ No answers found to submit.");
      return;
    }

    await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/submit-group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId,
        groupIndex: fallbackIndex,
        studentId: user.id,
        answers
      })
    });

    window.location.reload();
  }

  if (activeStudentId == null) {
    return (
      <Container className="mt-4">
        <Alert variant="warning">⏳ Waiting for an active student to be assigned...</Alert>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      <h2>Run Activity: {activity?.title || activity?.name}</h2>
      {isActive
        ? <Alert variant="success">✅ You are the active student. You may submit responses.</Alert>
        : <Alert variant="info">⏳ You are currently observing. The active student is {activeStudentName || 'loading'}.</Alert>
      }

      {renderBlocks(preamble, { editable: false, isActive: false, mode: 'run' })}

      {groups.map((group, index) => {
        const stateKey = `${index + 1}state`;
        const complete = existingAnswers[stateKey] === 'complete';
        const isCurrent = index === fallbackIndex;
        const editable = isCurrent && isActive && !complete;

        if (!isActive && !complete && !isCurrent) return null;
        if (isActive && index > fallbackIndex) return null;

        return (
          <div key={`group-${index}`} className="mb-4">
            <p><strong>{group.intro.groupId}.</strong> {group.intro.content}</p>
            {renderBlocks(group.content, {
              editable,
              isActive,
              mode: 'run',
              prefill: existingAnswers
            })}
            {editable && (
              <div className="mt-2">
                <Button onClick={handleSubmit}>Submit and Continue</Button>
              </div>
            )}
          </div>
        );
      })}

      {fallbackIndex === groups.length && (
        <Alert variant="success">🎉 All groups complete! Review your responses above.</Alert>
      )}
    </Container>
  );
}