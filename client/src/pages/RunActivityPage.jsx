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
import { io } from 'socket.io-client';


// Map short role keys to full names
const roleLabels = {
  qc: 'Quality Control'
};

export default function RunActivityPage({ setRoleLabel, setStatusText, groupMembers, setGroupMembers, activeStudentId, setActiveStudentId, }) {
  const { instanceId } = useParams();
  const location = useLocation();
  const courseName = location.state?.courseName;
  const { user, loading } = useUser();
  const [followupsShown, setFollowupsShown] = useState({}); // { qid: followupQuestion }
  const [followupAnswers, setFollowupAnswers] = useState({}); // { qid: studentAnswer }
  const [codeFeedbackShown, setCodeFeedbackShown] = useState({}); // { qid: feedback string }
  const [socket, setSocket] = useState(null);
  const [fileContents, setFileContents] = useState({});
  const fileContentsRef = useRef(fileContents);


  const [activity, setActivity] = useState(null);
  const [groups, setGroups] = useState([]);
  //const [groupMembers, setGroupMembers] = useState([]);
  //const [activeStudentId, setActiveStudentId] = useState(null);
  const [activeStudentName, setActiveStudentName] = useState('');
  const [preamble, setPreamble] = useState([]);
  const [existingAnswers, setExistingAnswers] = useState({});
  const [skulptLoaded, setSkulptLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);


  const isActive = user && user.id === activeStudentId;
  const isInstructor = user?.role === 'instructor' || user?.role === 'root' || user?.role === 'creator';


  const userRoles = groupMembers
    .filter(m => String(m.student_id) === String(user.id))
    .map(m => m.role)
    .filter(Boolean); // remove undefined/null
  const userRole = userRoles.length > 0
    ? userRoles.map(role => roleLabels[role] || role).join(', ')
    : 'unknown';


  const activeStudentRoles = groupMembers
    .filter(m => String(m.student_id) === String(activeStudentId))
    .map(m => m.role)
    .filter(Boolean);
  const activeStudentRole = activeStudentRoles.length > 0
    ? activeStudentRoles.map(role => roleLabels[role] || role).join(', ')
    : 'unknown';


  const currentQuestionGroupIndex = useMemo(() => {
    if (!existingAnswers || Object.keys(existingAnswers).length === 0) return 0;
    let count = 0;
    while (count < groups.length && existingAnswers[`${count + 1}state`]?.response === 'completed') {
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
      } catch { }
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
      } catch { }
    };
    loadSkulpt();
  }, []);

  useEffect(() => {
    if (user?.id) {
      loadActivity();
    }
  }, [user?.id, instanceId]);

  useEffect(() => {
    const newSocket = io(API_BASE_URL); // API_BASE_URL should point to your backend
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (socket && instanceId) {
      socket.emit('joinRoom', instanceId);
    }
  }, [socket, instanceId]);


  useEffect(() => {
    if (!socket) return;

    const handleUpdate = ({ responseKey, value, followupPrompt }) => {
      if (responseKey.endsWith('FA1')) {
        const qid = responseKey.replace('FA1', '');

        // 1. Update follow-up answer
        setFollowupAnswers(prev => ({
          ...prev,
          [responseKey]: value
        }));

        // 2. Ensure follow-up prompt is shown
        setFollowupsShown(prev => ({
          ...prev,
          [qid]: followupPrompt || prev[qid] || 'Follow-up question'
        }));
      } else {
        // Sample or original response
        setExistingAnswers(prev => ({
          ...prev,
          [responseKey]: { ...prev[responseKey], response: value, type: 'text' }
        }));
      }
    };

    socket.on('response:update', handleUpdate);

    // 🧠 Listen for AI feedback updates
    socket.on('feedback:update', ({ responseKey, feedback }) => {
      console.log(`📡 Received feedback for ${responseKey}:`, feedback);
      setCodeFeedbackShown(prev => ({
        ...prev,
        [responseKey]: feedback,
      }));
    });

    return () => {
      socket.off('response:update', handleUpdate);
      socket.off('feedback:update'); // ✅ clean up feedback listener
    };

  }, [socket]);

  useEffect(() => {
    if (!isActive || !user?.id || !instanceId) return;

    const interval = setInterval(() => {
      const textToSave = {};

      // Collect sample (original) responses
      for (const [key, val] of Object.entries(existingAnswers)) {
        if (val?.type === 'text' && val.response?.trim()) {
          textToSave[key] = val.response.trim();
        }
      }

      // Collect follow-up responses
      for (const [key, val] of Object.entries(followupAnswers)) {
        if (val?.trim()) {
          textToSave[key] = val.trim();
        }
      }

      if (Object.keys(textToSave).length > 0) {
        fetch(`${API_BASE_URL}/api/responses/bulk-save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceId,
            userId: user.id,
            answers: textToSave
          })
        }).then(res => {
          if (!res.ok) console.warn('⚠️ Autosave failed');
        }).catch(err => {
          console.error('❌ Autosave error:', err);
        });
      }
    }, 10000); // every 10 seconds

    return () => clearInterval(interval);
  }, [isActive, user?.id, instanceId, existingAnswers, followupAnswers]);


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


  useEffect(() => {
    if (setRoleLabel) setRoleLabel(userRole);
    if (setStatusText) setStatusText(isActive ? "You are the active student" : "You are currently observing");
  }, [userRole, isActive, setRoleLabel, setStatusText]);


  useEffect(() => {
    const navbar = document.querySelector('.navbar');

    if (navbar) {
      if (user?.id === activeStudentId) {
        navbar.classList.remove('bg-primary', 'bg-dark');
        navbar.classList.add('bg-success');
      } else {
        navbar.classList.remove('bg-success', 'bg-dark');
        navbar.classList.add('bg-primary');
      }
    }

    return () => {
      if (navbar) {
        navbar.classList.remove('bg-success', 'bg-primary');
        navbar.classList.add('bg-dark');
      }
    };
  }, [user?.id, activeStudentId]);

  console.log("🔍 User:", user);

  if (loading) {
    return (
      <Container className="mt-4">
        <Spinner animation="border" />
      </Container>
    );
  }

  if (!user) {
    return (
      <Container className="mt-4">
        <Alert variant="danger">User not loaded. Please log in again.</Alert>
      </Container>
    );
  }


  async function loadActivity() {
    try {
      const instanceRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
      let instanceData = await instanceRes.json(); // ✅ make it mutable

      console.log("🧾 instanceData.sheet_url =", instanceData.sheet_url);
      setActivity(instanceData);

      if (!instanceData.total_groups) {
        await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/refresh-groups`);
        const updatedRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
        const updatedData = await updatedRes.json();
        setActivity(updatedData);
        instanceData = updatedData; // ✅ FIX: use updated data for doc preview
      }

      const activeRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`, {
        credentials: 'include',
      });
      const activeData = await activeRes.json();
      setActiveStudentId(activeData.activeStudentId);

      const groupRes = await fetch(`${API_BASE_URL}/api/groups/instance/${instanceId}`);
      const groupData = await groupRes.json();
      let userGroup = null;
      if (user?.id) {
        userGroup = groupData.groups.find(g => g.members.some(m => m.student_id === user.id));
      }

      if (userGroup) setGroupMembers(userGroup.members);

      const answersRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/responses`);
      const answersData = await answersRes.json();
      setCodeFeedbackShown(prev => {
        const merged = { ...prev };
        for (const [qid, entry] of Object.entries(answersData)) {
          if ('python_feedback' in entry && entry.python_feedback !== undefined) {
            merged[qid] = entry.python_feedback;
          }
        }
        return merged;
      });

      setExistingAnswers(prev => ({
        ...prev,
        ...answersData
      }));
      const newFollowupsData = {};
      for (const [qid, entry] of Object.entries(answersData)) {
        if (qid.endsWith('FA1')) {
          newFollowupsData[qid] = entry.response;
        }
      }


      setFollowupAnswers(prev => ({
        ...prev,
        ...newFollowupsData  // if any
      }));


      const newFollowupsShown = {};
      for (const [qid, entry] of Object.entries(answersData)) {
        if (qid.endsWith('F1')) {
          const baseQid = qid.replace('F1', '');
          newFollowupsShown[baseQid] = entry.response;
        }
      }

      setFollowupsShown(prev => ({
        ...prev,
        ...newFollowupsShown
      }));


      // Step 6: Parse Google Doc structure

      const docUrl = instanceData.sheet_url;
      if (!docUrl || docUrl === 'undefined') {
        console.warn("❌ Skipping doc preview because sheet_url is missing or undefined:", docUrl);
      } else {
        const docRes = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(docUrl)}`);
        const { lines } = await docRes.json();
        const blocks = parseSheetToBlocks(lines);
        // Extract metadata fields from headers
        const activityContextBlock = blocks.find(
          (b) => b.type === "header" && b.tag === "activitycontext"
        );
        const studentLevelBlock = blocks.find(
          (b) => b.type === "header" && b.tag === "studentlevel"
        );

        // Attach these values to the activity object so we can use them later
        instanceData.activitycontext = activityContextBlock?.content || "";
        instanceData.studentlevel = studentLevelBlock?.content || "";


        // ✅ Add console.log here
        console.log("🆕 Extracted metadata from sheet:", {
          activitycontext: instanceData.activitycontext,
          studentlevel: instanceData.studentlevel
        });

        const files = {};
        for (const block of blocks) {
          if (block.type === 'file' && block.filename) {
            files[block.filename] = block.content || "";  // Preserve even empty files
          }
        }
        setFileContents(prev => {
          const updated = { ...files };
          for (const [name, content] of Object.entries(prev)) {
            updated[name] = content; // Keep existing edits
          }
          fileContentsRef.current = updated;
          return updated;
        });

        fileContentsRef.current = files;

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
      }


    } catch (err) {
      console.error('Failed to load activity data', err);
    }
  }

  async function evaluateResponseWithAI(questionBlock, studentAnswer) {
    const body = {
      questionText: questionBlock.prompt,
      studentAnswer,
      sampleResponse: questionBlock.samples?.[0] || '',
      feedbackPrompt: questionBlock.feedback?.[0] || '',
      followupPrompt: questionBlock.followups?.[0] || '',
      context: {
        activitycontext:
          activity?.activitycontext ||
          activity?.title ||
          activity?.name ||
          "Untitled Activity",
        studentLevel: activity?.studentlevel || "intro",
      }

    };
    // ✅ Add console.log here
    console.log("📡 Context being sent to AI:", body.context);

    console.log('📡 Sending to AI:', body);

    try {
      const res = await fetch(`${API_BASE_URL}/api/ai/evaluate-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      console.log('🤖 AI returned:', data);
      return data.followupQuestion || null;
    } catch (err) {
      console.error('❌ AI call failed:', err);
      return null;
    }
  }
  function buildMarkdownTableFromBlock(block, container) {
    if (!block.tableBlocks?.length) return '';

    let result = '';
    for (let t = 0; t < block.tableBlocks.length; t++) {
      const table = block.tableBlocks[t];
      result += `### ${table.title || 'Table'}\n\n`;

      // Determine header length from first row
      const colCount = table.rows[0]?.length || 0;

      // Build rows
      const markdownRows = [];

      for (let row = 0; row < table.rows.length; row++) {
        const cells = table.rows[row].map((cell, col) => {
          if (cell.type === 'static') {
            return cell.content || '';
          } else if (cell.type === 'input') {
            const key = `${block.groupId}${block.id}table${t}cell${row}_${col}`;
            const val = container.querySelector(`[data-question-id="${key}"]`)?.value?.trim() || '';
            return val;
          }
          return '';
        });
        markdownRows.push(`| ${cells.join(' | ')} |`);
      }

      // Insert markdown header if table has rows
      if (markdownRows.length > 0) {
        const header = markdownRows[0];
        const separator = `| ${'--- |'.repeat(colCount)}`;
        result += [header, separator, ...markdownRows.slice(1)].join('\n') + '\n\n';
      }
    }

    return result;
  }

  async function handleSubmit() {
    if (isSubmitting) return;        // ✅ Prevent double clicks
    setIsSubmitting(true);           // ✅ Show spinner
    const container = document.querySelector('[data-current-group="true"]');
    if (!container) {
      alert("Error: No editable group found.");
      return;
    }

    // 🔄 Save unsaved Python edits before submission
    const codeTextareas = container.querySelectorAll('textarea[id^="sk-code-"]');
    for (let textarea of codeTextareas) {
      const responseKey = textarea.getAttribute('data-response-key');
      const currentCode = textarea.value.trim();
      if (responseKey && currentCode) {
        await handleCodeChange(responseKey, currentCode);
      }
    }


    const currentGroup = groups[currentQuestionGroupIndex];
    const blocks = [currentGroup.intro, ...currentGroup.content];
    const answers = {};
    const unanswered = [];

    for (let block of blocks) {
      if (block.type !== 'question') continue;

      const qid = `${block.groupId}${block.id}`;

      const el = container.querySelector(`[data-question-id="${qid}"]`);
      const baseAnswer = el?.value?.trim() || ''; // ✅ move this up

      const tableMarkdown = buildMarkdownTableFromBlock(block, container);
      const aiInput = block.hasTableResponse ? tableMarkdown : baseAnswer;

      let tableHasInput = false;
      if (block.tableBlocks?.length > 0) {
        for (let t = 0; t < block.tableBlocks.length; t++) {
          const table = block.tableBlocks[t];
          for (let row = 0; row < table.rows.length; row++) {
            for (let col = 0; col < table.rows[row].length; col++) {
              const cell = table.rows[row][col];
              if (cell.type === 'input') {
                const key = `${qid}table${t}cell${row}_${col}`;
                const val = container.querySelector(`[data-question-id="${key}"]`)?.value?.trim() || '';
                if (val !== '') {
                  answers[key] = val;
                  tableHasInput = true;
                }
              }
            }
          }
        }
      }

      // 🧠 If follow-up metadata exists and none shown yet, trigger AI
      if (
        aiInput &&
        block.followups?.length > 0 &&
        !followupsShown[qid]
      ) {
        console.log("⚡ Will trigger AI for QID", qid);
        const aiFollowup = await evaluateResponseWithAI(block, aiInput);
        if (aiFollowup) {
          setFollowupsShown(prev => ({ ...prev, [qid]: aiFollowup }));
          alert(`A follow-up question has been added for ${qid}. Please answer it.`);
          setIsSubmitting(false);
          return;
        }
      }

      const followupPrompt = followupsShown[qid];
      const followupKey = `${qid}FA1`;
      const followupAnswer = followupAnswers[followupKey]?.trim();

      if (followupPrompt && !followupAnswer) {
        unanswered.push(qid);
        continue;
      }

      if (baseAnswer && followupPrompt && followupAnswer) {
        answers[qid] = baseAnswer;
        answers[`${qid}S`] = 'completed';
        answers[`${qid}F1`] = followupPrompt;
        answers[followupKey] = followupAnswer;
        continue;
      }


      if (baseAnswer) {
        answers[qid] = baseAnswer;
      } else if (tableHasInput) {
        answers[qid] = tableMarkdown; // optional: store markdown version
      } else {
        unanswered.push(qid);
      }


      answers[`${qid}S`] = unanswered.includes(qid) ? 'inprogress' : 'completed';

      // ✅ NEW: collect table responses
      if (block.tableBlocks?.length > 0) {
        for (let t = 0; t < block.tableBlocks.length; t++) {
          const table = block.tableBlocks[t];
          for (let row = 0; row < table.rows.length; row++) {
            for (let col = 0; col < table.rows[row].length; col++) {
              const cell = table.rows[row][col];
              if (cell.type === 'input') {
                const key = `${qid}table${t}cell${row}_${col}`;
                const val = container.querySelector(`[data-question-id="${key}"]`)?.value?.trim() || '';
                if (val !== '') {
                  answers[key] = val;
                }
              }
            }
          }
        }
      }
    }


    // If there are unanswered questions, we treat this as "inprogress"
    const groupState = unanswered.length === 0 ? 'completed' : 'inprogress';

    if (groupState === 'inprogress') {
      alert(`Partial draft saved. Still missing: ${unanswered.join(', ')}`);
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/submit-group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupIndex: currentQuestionGroupIndex,
          studentId: user.id,
          groupState,
          answers
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(`Submission failed: ${errorData.error || 'Unknown error'}`);
      } else {
        setFollowupsShown({});
        setFollowupAnswers({});
        await loadActivity(); // ✅ Reload server state

        if (currentQuestionGroupIndex + 1 === groups.length) {
          console.log("Mark complete triggered for instance:", instanceId);
          await fetch(`${API_BASE_URL}/api/responses/mark-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instanceId }),
          });
        }
      }

    } catch (err) {
      console.error("❌ Submission failed:", err);
      alert("An error occurred during submission.");
    } finally {
      setIsSubmitting(false); // ✅ hide spinner after everything
    }
  }

  async function handleCodeChange(responseKey, updatedCode) {
    try {
      // Step 1: Save code
      await fetch(`${API_BASE_URL}/api/responses/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: responseKey,
          activity_instance_id: instanceId,
          user_id: user?.id,
          response: updatedCode, // ✅ note the key here
        }),
      });
      console.log("✅ Code saved for:", responseKey);

      // Step 2: Call AI for feedback
      const aiRes = await fetch(`${API_BASE_URL}/api/ai/evaluate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionText: "Review the student's code and offer helpful feedback if needed.",
          studentCode: updatedCode,
          codeVersion: responseKey,
        }),
      });

      const aiData = await aiRes.json();
      if (aiData.feedback) {
        console.log(`🤖 AI feedback for ${responseKey}:`, aiData.feedback);

        // Save feedback to DB
        await fetch(`${API_BASE_URL}/api/responses/save-feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: responseKey,
            activity_instance_id: instanceId,
            user_id: user?.id,
            response_type: 'python_feedback',
            feedback: aiData.feedback,
          }),
        });

        // 1. Save locally
        setCodeFeedbackShown(prev => ({
          ...prev,
          [responseKey]: aiData.feedback,
        }));

        // 2. 🔁 Emit to observers
        if (socket && instanceId) {
          socket.emit('feedback:update', {
            instanceId,
            responseKey,
            feedback: aiData.feedback,
          });
        }

      } else {
        console.log(`🤖 No feedback needed for ${responseKey}`);

        // Clear feedback locally
        setCodeFeedbackShown(prev => ({
          ...prev,
          [responseKey]: null,
        }));

        // 🔁 Emit empty feedback to clear for observers
        if (socket && instanceId) {
          socket.emit('feedback:update', {
            instanceId,
            responseKey,
            feedback: null,
          });
        }
      }

    } catch (err) {
      console.error("❌ Failed in handleCodeChange:", responseKey, err);
    }
  }



  return (
    <>

      <Container className="pt-3 mt-2">



        <h2>{activity?.title ? `Activity: ${activity.title}` : (courseName ? `Course: ${courseName}` : "Untitled Activity")}</h2>
        {/*
        {isActive ? (
          <Alert variant="success">
            You are the active student. Your role is <strong>{userRole}</strong>. You may submit responses.
          </Alert>
        ) : (
          <Alert variant="info">
            You are currently observing.
            {!isInstructor && userRole !== 'unknown' && (
              <> Your role is <strong>{userRole}</strong>.</>
            )}
            {" "}
            The active student is <strong>{activeStudentName || '(unknown)'}</strong>
            {!isInstructor && activeStudentRole !== 'unknown' && (
              <> (<strong>{activeStudentRole}</strong>).</>
            )}
          </Alert>
        )}
       */}


        {renderBlocks(preamble, {
          editable: false,
          isActive: false,
          mode: 'run',
          codeFeedbackShown, // ✅ FIX added here                                                                     
        })}

        {groups.map((group, index) => {
          const stateKey = `${index + 1}state`;
          const isComplete = existingAnswers[stateKey]?.response === 'completed';
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

                socket,
                instanceId,
                answeredBy: user?.id,
                fileContents,
                setFileContents: handleUpdateFileContents,
                onCodeChange: handleCodeChange,
                codeFeedbackShown,
                onTextChange: (responseKey, value) => {
                  if (responseKey.endsWith('FA1')) {
                    // 🔄 Follow-up response: update followupAnswers
                    setFollowupAnswers(prev => ({
                      ...prev,
                      [responseKey]: value
                    }));
                  } else {
                    // 📝 Sample (original) response: update existingAnswers
                    setExistingAnswers(prev => ({
                      ...prev,
                      [responseKey]: { ...prev[responseKey], response: value, type: 'text' }
                    }));
                  }

                  // 📢 Emit for live sync
                  if (isActive && socket) {
                    socket.emit('response:update', {
                      instanceId,
                      responseKey,
                      value,
                      answeredBy: user.id
                    });
                  }
                }

              })}


              {editable && (
                <div className="mt-2">
                  <Button onClick={handleSubmit} disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Loading...
                      </>
                    ) : (
                      "Submit and Continue"
                    )}
                  </Button>
                </div>
              )}

            </div>
          );
        })}

        {groups.length > 0 && currentQuestionGroupIndex === groups.length && (
          <Alert variant="success">All groups complete! Review your responses above.</Alert>
        )}
      </Container>
    </>
  );
}
