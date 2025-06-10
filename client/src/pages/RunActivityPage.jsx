// client/src/pages/RunActivityPage.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Alert, Button, Spinner } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';

import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';

export default function RunActivityPage() {
  const { instanceId } = useParams();
  const { user, loading } = useUser();
  const [followupsShown, setFollowupsShown] = useState({}); // { qid: followupQuestion }
  const [followupAnswers, setFollowupAnswers] = useState({}); // { qid: studentAnswer }
  const [codeFeedbackShown, setCodeFeedbackShown] = useState({}); // { qid: feedback string }




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
      }

      // Always load answers, even if user is not in a group
      const answersRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/responses`);
      const answersData = await answersRes.json();
      console.log("📦 Observer fetched answers:", answersData);

      // ✅ Extract AI feedback for each Python block
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
      if (!el) {
        unanswered.push(qid);
        continue;
      }

      const baseAnswer = el.value?.trim();
      const followupPrompt = followupsShown[qid];
      const followupAnswer = followupAnswers[qid]?.trim();

      // 🧠 If follow-up exists and not answered, pause
      if (followupPrompt && !followupAnswer) {
        unanswered.push(qid);
        continue;
      }

      // 🧠 If follow-up exists and answered, combine both
      if (baseAnswer && followupPrompt && followupAnswer) {
        console.log("🧠 Combining base and follow-up answers for QID", qid);
        console.log("Base answer:", baseAnswer);
        console.log("Follow-up prompt:", followupPrompt);
        console.log("Follow-up answer:", followupAnswer);
        answers[qid] = baseAnswer; // main answer
        answers[`${qid}S`] = 'complete'; // state
        if (followupPrompt) {
          answers[`${qid}F1`] = followupPrompt;
        }
        if (followupAnswer) {
          answers[`${qid}FA1`] = followupAnswer;
        } continue;
      }
      answers[`${qid}S`] = unanswered.includes(qid) ? 'inprogress' : 'complete';


      // 🧠 If follow-up metadata exists and none shown yet, trigger AI
      if (
        baseAnswer &&
        block.followups?.length > 0 &&
        !followupsShown[qid]
      ) {
        console.log("⚡ Will trigger AI for QID", qid);

        const aiFollowup = await evaluateResponseWithAI(block, baseAnswer);
        if (aiFollowup) {
          setFollowupsShown(prev => ({ ...prev, [qid]: aiFollowup }));
          alert(`A follow-up question has been added for ${qid}. Please answer it.`);
          setIsSubmitting(false); // ✅ unlock spinner!
          return;
        }
        answers[qid] = baseAnswer;
        continue;
      }

      // 🧠 No follow-up logic, just base answer
      if (baseAnswer) {
        answers[qid] = baseAnswer;
        continue;
      }

      unanswered.push(qid); // No valid data
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
      <h2>Run Activity: {activity?.title || activity?.name}</h2>
      {isActive
        ? <Alert variant="success">You are the active student. You may submit responses.</Alert>
        : <Alert variant="info">You are currently observing. The active student is {activeStudentName || '(unknown)'}</Alert>}

      {renderBlocks(preamble, {
        editable: false,
        isActive: false,
        mode: 'run',
        codeFeedbackShown, // ✅ FIX added here
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