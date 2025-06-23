// client/src/pages/RunActivityPage.jsx
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { Container, Alert, Button, Spinner } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';

import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';

export default function RunActivityPage() {
  const { instanceId } = useParams();
  const location = useLocation();
  const courseName = location.state?.courseName;
  const { user, loading } = useUser();
  const [followupsShown, setFollowupsShown] = useState({});
  const [followupAnswers, setFollowupAnswers] = useState({});
  const [codeFeedbackShown, setCodeFeedbackShown] = useState({});
  const [fileContents, setFileContents] = useState({});
  const fileContentsRef = useRef(fileContents);
  const [activity, setActivity] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [activeStudentId, setActiveStudentId] = useState(null);
  const [activeStudentName, setActiveStudentName] = useState('');
  const [existingAnswers, setExistingAnswers] = useState({});
  const [skulptLoaded, setSkulptLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isActive = user && user.id === activeStudentId;
  const isInstructor = user?.role === 'instructor' || user?.role === 'root' || user?.role === 'creator';

  const currentQuestionGroupIndex = useMemo(() => {
    if (!existingAnswers || Object.keys(existingAnswers).length === 0) return 0;
    let count = 0;
    while (count < groups.length && existingAnswers[`${count + 1}state`]?.response === 'complete') {
      count++;
    }
    return count;
  }, [existingAnswers, groups]);

  const handleUpdateFileContents = (updaterFn) => {
    setFileContents((prev) => {
      const updated = updaterFn(prev);
      fileContentsRef.current = updated;
      return updated;
    });
  };

  useEffect(() => { fileContentsRef.current = fileContents; }, [fileContents]);

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
    const interval = setInterval(() => {
      loadActivity();
    }, 10000);
    return () => clearInterval(interval);
  }, [instanceId]);

  useEffect(() => {
    const sendHeartbeat = async () => {
      if (!user?.id || !instanceId) return;
      try {
        await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id })
        });
      } catch {}
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 20000);
    return () => clearInterval(interval);
  }, [user?.id, instanceId]);

  useEffect(() => {
    const loadScript = (src) => new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
    const loadSkulpt = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');
        if (window.Sk && window.Sk.builtinFiles) setSkulptLoaded(true);
      } catch {}
    };
    loadSkulpt();
  }, []);

  useEffect(() => {
    loadActivity();
  }, []);

  useEffect(() => {
    if (!activeStudentId) return;
    const student = groupMembers.find(m => String(m.student_id) === String(activeStudentId));
    if (student) {
      setActiveStudentName(student.name);
    } else {
      fetch(`${API_BASE_URL}/api/users/${activeStudentId}`)
        .then(res => res.json())
        .then(userData => setActiveStudentName(userData.name || '(unknown)'))
        .catch(() => setActiveStudentName('(unknown)'));
    }
  }, [activeStudentId, groupMembers]);

  useEffect(() => {
    Prism.highlightAll();
  }, [groups]);

  async function loadActivity() {
    try {
      const instanceRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
      const instanceData = await instanceRes.json();
      setActivity(instanceData);

      if (!instanceData.total_groups) {
        await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/refresh-groups`);
        const updatedRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
        const updatedData = await updatedRes.json();
        setActivity(updatedData);
      }

      const activeRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`, {
        credentials: 'include',
      });
      const activeData = await activeRes.json();
      setActiveStudentId(activeData.activeStudentId);

      const groupRes = await fetch(`${API_BASE_URL}/api/groups/instance/${instanceId}`);
      const groupData = await groupRes.json();
      const userGroup = groupData.groups.find(g => g.members.some(m => m.student_id === user.id));
      if (userGroup) setGroupMembers(userGroup.members);

      const answersRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/responses`);
      const answersData = await answersRes.json();
      setCodeFeedbackShown(prev => {
        const merged = { ...prev };
        for (const [qid, entry] of Object.entries(answersData)) {
          if (entry.type === 'python' && entry.python_feedback) {
            merged[qid] = entry.python_feedback;
          }
        }
        return merged;
      });
      setExistingAnswers(answersData);

      const docRes = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(instanceData.sheet_url)}`);
      const { lines } = await docRes.json();
      const blocks = parseSheetToBlocks(lines);

      const files = {};
      for (const block of blocks) {
        if (block.type === 'file' && block.filename && block.content) {
          files[block.filename] = block.content;
        }
      }
      setFileContents(files);
      fileContentsRef.current = files;

      const grouped = [];
      let currentGroup = null;
      for (let block of blocks) {
        if (block.type === 'groupIntro') {
          if (currentGroup) grouped.push(currentGroup);
          currentGroup = { intro: block, content: [] };
        } else if (block.type === 'endGroup') {
          if (currentGroup) { grouped.push(currentGroup); currentGroup = null; }
        } else if (currentGroup) {
          currentGroup.content.push(block);
        }
      }
      setGroups(grouped);
    } catch (err) {
      console.error('Failed to load activity data', err);
    }
  }

  return (
    <Container className="mt-4">
      <h2>{activity?.title ? `Activity: ${activity.title}` : (courseName ? `Course: ${courseName}` : "Untitled Activity")}</h2>
      {isActive
        ? <Alert variant="success">You are the active student. You may submit responses.</Alert>
        : <Alert variant="info">You are currently observing. The active student is {activeStudentName || '(unknown)'}</Alert>}

      {groups.map((group, index) => {
        const stateKey = `${index + 1}state`;
        const isComplete = existingAnswers[stateKey]?.response === 'complete';
        const isCurrent = index === currentQuestionGroupIndex;
        const isFuture = index > currentQuestionGroupIndex;

        const editable = isActive && isCurrent && !isComplete;
        const showGroup = isInstructor || isComplete || isCurrent;
        if (!showGroup) return null;

        return (
          <div
            key={`group-${index}`}
            className="mb-4"
            data-current-group={editable ? "true" : undefined}
          >
            <p><strong>{index + 1}.</strong> {group.intro.content}</p>
            {renderBlocks(group.content, {
              editable,
              isActive,
              mode: 'run',
              prefill: existingAnswers,
              currentGroupIndex: index,
              followupsShown,
              followupAnswers,
              setFollowupAnswers,
              fileContentsRef,
              setFileContents: handleUpdateFileContents,
              onCodeChange: async () => {}, // placeholder
              codeFeedbackShown
            })}
          </div>
        );
      })}

      {currentQuestionGroupIndex === groups.length && (
        <Alert variant="success">All groups complete! Review your responses above.</Alert>
      )}
    </Container>
  );
}
