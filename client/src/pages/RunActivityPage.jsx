// client/src/pages/RunActivityPage.jsx
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
  console.log("🔍 User data:", user);

  const [activity, setActivity] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [activeStudentId, setActiveStudentId] = useState(null);
  const [activeStudentName, setActiveStudentName] = useState('');
  const [preamble, setPreamble] = useState([]);
  const [existingAnswers, setExistingAnswers] = useState({});

  const isActive = user.id === activeStudentId;

  const [skulptLoaded, setSkulptLoaded] = useState(false);

useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve(); // already loaded
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
          console.log(`✅ Loaded ${src}`);
          resolve();
        };
        script.onerror = () => {
          console.error(`❌ Failed to load ${src}`);
          reject(new Error(`Failed to load script ${src}`));
        };
        document.head.appendChild(script); // use <head> for better priority
      });
  
      const loadSkulpt = async () => {
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
          await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');
      
          if (window.Sk && window.Sk.builtinFiles) {
            console.log('✅ Skulpt is ready');
            setSkulptLoaded(true); 
          } else {
            console.warn('⚠️ Skulpt scripts loaded, but core objects not initialized');
          }
        } catch (err) {
          console.error('🚨 Skulpt failed to load', err);
        }
      };
  
    loadSkulpt();
  }, []);
    
  useEffect(() => {
    loadActivity(); 
  }, []);

  useEffect(() => {
    Prism.highlightAll();
  }, [groups]);

  async function loadActivity() {
    try {
      
      console.log("🔍 Fetching instance");
      const instanceRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
      const instanceData = await instanceRes.json();
      console.log("✅ Instance data", instanceData);
  
      setActivity(instanceData); // Fix: ensure activity is set early
  
      // Fetch active student (move this up so the ID is available earlier)
      console.log("🔍 Fetching active student");
      const res = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`, {
        credentials: 'include'
      });
      
      const activeData = await res.json();
      setActiveStudentId(activeData.activeStudentId);
      console.log("✅ Active student ID:", activeData.activeStudentId);
  
      console.log("🔍 Fetching groups for instance", instanceId);
      const groupRes = await fetch(`${API_BASE_URL}/api/groups/instance/${instanceId}`);
      const groupData = await groupRes.json();
      console.log("✅ Group data", groupData);
  
      const userGroup = groupData.groups.find(g =>
        g.members.some(m => m.student_id === user.id)
      );
      console.log("👤 Matched user group", userGroup);
  
      if (userGroup) {
        setGroupId(userGroup.group_id);
        setGroupMembers(userGroup.members);
  
        console.log("🔍 Fetching responses for group", userGroup.group_id);
        const answersRes = await fetch(`${API_BASE_URL}/api/responses/${instanceId}/${userGroup.group_id}`);
        const answersData = await answersRes.json();
        setExistingAnswers(Object.fromEntries(
          Object.entries(answersData).map(([qid, val]) => [qid, val.response])
        ));
      } else {
        console.warn("⚠️ User is not assigned to any group!");
      }
  
      console.log("🔍 Fetching document lines");
      const docRes = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(instanceData.sheet_url)}`);
      const { lines } = await docRes.json();
      console.log("✅ Document lines fetched", lines.length);
  
      const blocks = parseSheetToBlocks(lines);
      console.log("🧱 Parsed blocks", blocks.length);
  
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
      console.error('❌ Error loading activity data', err);
    }
  }
  

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