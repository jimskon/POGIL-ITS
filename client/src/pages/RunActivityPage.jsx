// client/src/pages/RunActivityPage.jsx
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Alert, Button, Spinner } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';
import { useLocation } from 'react-router-dom';

import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';

export default function RunActivityPage() {
  const { instanceId } = useParams();
  const location = useLocation();                  // ✅ ADD THIS LINE
  const courseName = location.state?.courseName;   // ✅ AND THIS ONE
  const { user, loading } = useUser();
  const [followupsShown, setFollowupsShown] = useState({}); // { qid: followupQuestion }
  const [followupAnswers, setFollowupAnswers] = useState({}); // { qid: studentAnswer }
  const [codeFeedbackShown, setCodeFeedbackShown] = useState({}); // { qid: feedback string }
  const [fileContents, setFileContents] = useState({});
  const fileContentsRef = useRef(fileContents);

  const handleUpdateFileContents = (updaterFn) => {
    setFileContents((prev) => {
      const updated = updaterFn(prev);
      fileContentsRef.current = updated;
      return updated;
    });
  };

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
  const [activity, setActivity] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [activeStudentId, setActiveStudentId] = useState(null);
  const [activeStudentName, setActiveStudentName] = useState('');
  const [preamble, setPreamble] = useState([]);
  const [existingAnswers, setExistingAnswers] = useState({});
  const [skulptLoaded, setSkulptLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // ✅ Spinner control

  const isActive = user && user.id === activeStudentId;
  const isInstructor = user?.role === 'instructor' || user?.role === 'root' || user?.role === 'creator';
  console.log("👤 User role:", user.role, "→ isInstructor:", isInstructor);


  const currentQuestionGroupIndex = useMemo(() => {
    console.log("🧩 existingAnswers snapshot:", existingAnswers);

    if (!existingAnswers || Object.keys(existingAnswers).length === 0) {
      console.log("⚠️ existingAnswers not ready yet");
      return 0;
    }

    let count = 0;
    while (count < groups.length && existingAnswers[`${count + 1}state`]?.response === 'complete') {
      console.log(`✅ Skipping group ${count + 1} as complete`);
      count++;
    }

    console.log(`✅ currentQuestionGroupIndex after skipping:`, count);
    if (count === groups.length) {
      console.log("🎉 All groups complete");
    }

    return count;
  }, [existingAnswers, groups]);



  if (!user) {
    return (
      <Container className="mt-4">
        <Alert variant="danger">User not loaded. Please log in again.</Alert>
      </Container>
    );
  }

  // Keep ref in sync with state
  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        console.log("🔄2222 Loading activity instance:", instanceId);
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
      console.log("🔁 Polling activity for all users (code + feedback)");
      loadActivity(); // This will refresh all answers + feedback from the DB
    }, 10000); // every 10 seconds

    return () => clearInterval(interval); // cleanup when unmounting
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
      console.log("🔄 Loading activity instance:", instanceId);

      // Step 1: Fetch activity instance info (includes total_groups)
      const instanceRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
      const instanceData = await instanceRes.json();
      setActivity(instanceData);

      // Step 2: If total_groups is missing, refresh it from Google Doc
      if (!instanceData.total_groups) {
        console.log("🔁 total_groups missing, refreshing from Google Doc...");
        await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/refresh-groups`);

        // Re-fetch instance to get updated total_groups
        const updatedRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`);
        const updatedData = await updatedRes.json();
        setActivity(updatedData);
      }

      // Step 3: Get current active student
      const activeRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`, {
        credentials: 'include',
      });
      const activeData = await activeRes.json();
      setActiveStudentId(activeData.activeStudentId);

      // Step 4: Get group members
      const groupRes = await fetch(`${API_BASE_URL}/api/groups/instance/${instanceId}`);
      const groupData = await groupRes.json();
      const userGroup = groupData.groups.find(g => g.members.some(m => m.student_id === user.id));
      if (userGroup) {
        setGroupMembers(userGroup.members);
      }

      // Step 5: Load all responses (text + python)
      const answersRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/responses`);
      const answersData = await answersRes.json();
      console.log("📦 Observer fetched answers:", answersData);

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

      // Step 6: Parse Google Doc structure
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


  async function evaluateResponseWithAI(questionBlock, studentAnswer) {
    const body = {
      questionText: questionBlock.prompt,
      studentAnswer,
      sampleResponse: questionBlock.samples?.[0] || '',
      feedbackPrompt: questionBlock.feedback?.[0] || '',
      followupPrompt: questionBlock.followups?.[0] || '',
      context: {
        activityTitle: activity?.title || activity?.name || 'Untitled Activity',
        studentLevel: 'intro'
      }
    };

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
      const followupAnswer = followupAnswers[qid]?.trim();

      if (followupPrompt && !followupAnswer) {
        unanswered.push(qid);
        continue;
      }

      if (baseAnswer && followupPrompt && followupAnswer) {
        answers[qid] = baseAnswer;
        answers[`${qid}S`] = 'complete';
        if (followupPrompt) answers[`${qid}F1`] = followupPrompt;
        if (followupAnswer) answers[`${qid}FA1`] = followupAnswer;
        continue;
      }

      if (baseAnswer) {
        answers[qid] = baseAnswer;
      } else if (tableHasInput) {
        answers[qid] = tableMarkdown; // optional: store markdown version
      } else {
        unanswered.push(qid);
      }


      answers[`${qid}S`] = unanswered.includes(qid) ? 'inprogress' : 'complete';

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
    const groupState = unanswered.length === 0 ? 'complete' : 'inprogress';

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
        setCodeFeedbackShown(prev => ({
          ...prev,
          [responseKey]: aiData.feedback,
        }));
      } else {
        console.log(`🤖 No feedback needed for ${responseKey}`);
        setCodeFeedbackShown(prev => ({
          ...prev,
          [responseKey]: null,
        }));
      }
    } catch (err) {
      console.error("❌ Failed in handleCodeChange:", responseKey, err);
    }
  }


  return (
    <Container className="mt-4">
      <h2>{activity?.title ? `Activity: ${activity.title}` : (courseName ? `Course: ${courseName}` : "Untitled Activity")}</h2>
      {isActive
        ? <Alert variant="success">You are the active student. You may submit responses.</Alert>
        : <Alert variant="info">You are currently observing. The active student is {activeStudentName || '(unknown)'}</Alert>}

      {renderBlocks(preamble, {
        editable: false,
        isActive: false,
        mode: 'run',
        codeFeedbackShown, // ✅ FIX added here
        fileContentsRef,
        setFileContents: handleUpdateFileContents,
      })}

      {groups.map((group, index) => {
        const stateKey = `${index + 1}state`;
        const isComplete = existingAnswers[stateKey]?.response === 'complete';
        const isCurrent = index === currentQuestionGroupIndex;
        const isFuture = index > currentQuestionGroupIndex;

        const editable = isActive && isCurrent && !isComplete;
        const showGroup = isInstructor || isComplete || isCurrent;

        console.log(
          `👁️ Group ${index + 1} -- isInstructor: ${isInstructor}, isComplete: ${isComplete}, isCurrent: ${isCurrent}, isFuture: ${isFuture}, showGroup: ${showGroup}, editable: ${editable}`
        );

        if (!showGroup) return null;
        console.log("📦 Total groups loaded:", groups.length);

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
              setFileContents,
              onCodeChange: handleCodeChange,
              codeFeedbackShown, // ✅ new prop
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



      {currentQuestionGroupIndex === groups.length && (
        <Alert variant="success">All groups complete! Review your responses above.</Alert>
      )}
    </Container>
  );
}