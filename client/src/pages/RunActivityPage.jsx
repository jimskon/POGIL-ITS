import React, { useEffect, useState } from 'react';
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
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);

  const isActive =
    user.id === activeStudentId ||
    (groupMembers.length === 1 && groupMembers[0]?.student_id === user.id);

  // Load Prism syntax highlighting
  useEffect(() => {
    Prism.highlightAll();
  }, [groups]);

  // Load Skulpt
  useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
      });

    const loadSkulpt = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');
        console.log('✅ Skulpt loaded');
      } catch (err) {
        console.error('❌ Failed to load Skulpt', err);
      }
    };

    loadSkulpt();
  }, []);

  // Load activity instance + group + activity content
  useEffect(() => {
    async function loadActivity() {
      try {
        const instanceRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
        const instanceData = await instanceRes.json();

        if (!instanceData.activity_id) {
          throw new Error('❌ No activity_id in instance data!');
        }

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
        }

        const docRes = await fetch(
          `${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`
        );
        const { lines } = await docRes.json();
        const blocks = parseSheetToBlocks(lines);
        console.log("🔍 Parsed blocks:", blocks);

        const grouped = [];
        let currentGroup = null;
        for (let block of blocks) {
          if (block.type === 'groupIntro') {
            if (currentGroup) grouped.push(currentGroup);
            currentGroup = { intro: block, content: [] };
          } else if (currentGroup) {
            currentGroup.content.push(block);
          } else {
            // fallback: orphan blocks (e.g. Python blocks before any group) go in a dummy group
            grouped.push({ intro: { type: 'info', content: 'Orphaned Content' }, content: [block] });
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

  // Fetch active student
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

  // Send heartbeat
  useEffect(() => {
    const interval = setInterval(() => {
      if (!groupId) return;
      fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, groupId })
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [user.id, groupId, instanceId]);

  const currentGroup = groups[currentGroupIndex];
  if (!currentGroup)
    return (
      <Container>
        <Alert variant="info">🎉 Activity complete!</Alert>
      </Container>
    );

  return (
    <Container className="mt-4">
      <h2>Run Activity: {activity?.title || activity?.name}</h2>
      {isActive ? (
        <Alert variant="success">✅ You are the active student. You may submit responses.</Alert>
      ) : (
        <Alert variant="info">⏳ You are currently observing. The active student is submitting.</Alert>
      )}

      <p>
        <strong>{currentGroup.intro.groupId}.</strong> {currentGroup.intro.content}
      </p>

      {renderBlocks(currentGroup.content, {
        editable: isActive,
        isActive,
        onSave: (code) => {
          console.log('💾 Save:', code);
          // TODO: save-to-server logic
        },
        onSubmit: (code) => {
          console.log('📤 Submit:', code);
          setCurrentGroupIndex((prev) => prev + 1);
        }
      })}

      {isActive && (
        <div className="mt-3">
          <Button onClick={() => setCurrentGroupIndex((prev) => prev + 1)}>Submit and Continue</Button>
        </div>
      )}
    </Container>
  );
}
