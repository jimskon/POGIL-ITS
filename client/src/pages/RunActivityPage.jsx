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

function isNoAI(val) {
  return String(val ?? '').trim().toLowerCase() === 'none';
}




export default function RunActivityPage({ setRoleLabel, setStatusText, groupMembers, setGroupMembers, activeStudentId, setActiveStudentId, }) {
  const [lastEditTs, setLastEditTs] = useState(0);
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
  const loadingRef = useRef(false);
  const codeVersionsRef = useRef({});   // track versions per responseKey
  const qidsNoFURef = useRef(new Set());




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
      // If you’re the active student and you edited in the last 15s, skip refresh
      if (!isActive || Date.now() - lastEditTs > 15000) {
        loadActivity();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [instanceId, isActive, lastEditTs]);


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
        const attemptsKey = `${qid}attempts`;
        const prevAttempts = Number(existingAnswers[attemptsKey]?.response || 0);


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

    socket.on('feedback:update', ({ responseKey, feedback, followup }) => {
      console.log(`📡 Received feedback for ${responseKey}:`, { feedback, followup });

      // Inline feedback (per code cell)
      setCodeFeedbackShown(prev => ({
        ...prev,
        [responseKey]: feedback ?? null,
      }));

      // Banner is per-question (use followup, not feedback)
      const m = responseKey.match(/^(.*?)(?:code\d+)$/); // e.g. "3ccode1" -> "3c"
      if (m) {
        const qid = m[1];
        setFollowupsShown(prev => {
          const next = { ...prev };
          if (typeof followup === 'string' && followup.trim()) {
            next[qid] = followup;
          } else {
            delete next[qid];
          }
          return next;
        });
      }
    });


    // ...in cleanup:

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

  async function saveResponse(instanceId, key, value) {
    await fetch(`${API_BASE_URL}/api/responses/bulk-save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId,
        userId: user.id,
        answers: { [key]: value }
      })
    });
  }

  // ---------- TEXT UTILS (top-level) ----------
  function stripHtml(s = '') {
    return s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+>/g, '');
  }

  function cleanLines(s = '') {
    // remove HTML, trim left indentation and trailing spaces per line
    return stripHtml(s).replace(/^\s+/mg, '').replace(/[ \t]+$/mg, '');
  }


  async function loadActivity() {
    if (loadingRef.current) return;
    loadingRef.current = true;
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

      if (userGroup) {
        setGroupMembers(userGroup.members);
      } else {
        // ✅ NEW: allow elevated roles (root/instructor/creator) to see a roster
        const isInstructor = user?.role === 'instructor' || user?.role === 'root' || user?.role === 'creator';

        if (isInstructor) {
          // Prefer the active student’s group
          const activeId = activeData?.activeStudentId;
          const activeGroup = groupData.groups.find(g =>
            g.members.some(m => String(m.student_id) === String(activeId))
          );

          // Fallback: first group if no active student yet
          const fallbackGroup = groupData.groups?.[0];

          setGroupMembers(activeGroup?.members || fallbackGroup?.members || []);
        }
      }


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


      // Rebuild followupsShown now that qidsNoFURef is known
      const filteredFollowupsShown = {};
      for (const [qid, entry] of Object.entries(answersData)) {
        if (qid.endsWith('F1')) {
          const baseQid = qid.replace('F1', '');
          if (!qidsNoFURef.current.has(baseQid)) {
            filteredFollowupsShown[baseQid] = entry.response;
          }
        }
      }
      // Also purge any stale banners for QIDs that are in the no-FU set
      setFollowupsShown(prev => {
        const next = { ...prev, ...filteredFollowupsShown };
        for (const qid of qidsNoFURef.current) delete next[qid];
        return next;
      });



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

        const aiCodeGuideBlock = blocks.find(
          (b) => b.type === "header" && b.tag === "aicodeguidance"
        );

        // 2) Convert the header content to plain text
        const activitycontext = stripHtml(activityContextBlock?.content || "");
        const studentlevel = stripHtml(studentLevelBlock?.content || "");
        const aicodeguidance = stripHtml(aiCodeGuideBlock?.content || "");

        // 3) Save them into React state so evaluate-code can read them
        setActivity(prev => ({
          ...prev,
          ...instanceData,       // keep your original fields (title, etc.)
          activitycontext,
          studentlevel,
          aicodeguidance,
        }));

        console.log('🧭 aicodeguidance (clean):', (activity?.aicodeguidance || '').slice(0, 200));


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

        // --- NEW: group/preamble logic that supports sections between groups ---
        const grouped = [];
        const preamble = [];

        let seenAnyGroup = false;
        let currentGroup = null;

        // Collect blocks that appear after a group has ended and before the next one starts.
        // These will be attached to the NEXT group as a "prelude" shown before the group intro.
        let betweenGroups = [];

        for (const block of blocks) {
          if (block.type === 'groupIntro') {
            // close previous group if any
            if (currentGroup) grouped.push(currentGroup);

            // create new group
            currentGroup = { intro: block, prelude: [], content: [] };

            // attach everything we collected since the last group ended
            if (seenAnyGroup && betweenGroups.length) {
              currentGroup.prelude.push(...betweenGroups);
              betweenGroups = [];
            }

            seenAnyGroup = true;
            continue;
          }

          if (block.type === 'endGroup') {
            if (currentGroup) {
              grouped.push(currentGroup);
              currentGroup = null;
            }
            continue;
          }

          if (currentGroup) {
            // while inside a group, keep order as-is
            currentGroup.content.push(block);
          } else {
            // not inside a group
            if (!seenAnyGroup) {
              // before first group → preamble
              preamble.push(block);
            } else {
              // after a group, before the next one → buffer for the next group's prelude
              betweenGroups.push(block);
            }
          }
        }

        // flush leftovers
        if (currentGroup) grouped.push(currentGroup);

        // if the doc ended with some buffered blocks (after the last group),
        // append them to the last group's content (or preamble if no groups at all)
        if (betweenGroups.length) {
          if (grouped.length) {
            grouped[grouped.length - 1].content.push(...betweenGroups);
          } else {
            preamble.push(...betweenGroups);
          }
        }

        setGroups(grouped);
        const noSet = new Set();
        for (const g of grouped) {
          for (const b of [g.intro, ...(g.content || [])]) {
            if (b?.type === 'question') {
              const qid = `${b.groupId}${b.id}`;
              if (isNoAI(b?.followups?.[0]) || isNoAI(b?.feedback?.[0])) {
                noSet.add(qid);
              }
            }
          }
        }
        qidsNoFURef.current = noSet;
        setPreamble(preamble);

      }


    } catch (err) {
      console.error('Failed to load activity data', err);
    } finally {
      loadingRef.current = false;
    }
  }

  async function evaluateResponseWithAI(questionBlock, studentAnswer, { forceFollowup = false } = {}) {
    const feedbackRaw = stripHtml(questionBlock.feedback?.[0] || '');
    if (isNoAI(questionBlock?.followups?.[0]) || isNoAI(questionBlock?.feedback?.[0])) {
      return null; // <- hard stop: do not generate a followup
    }
    const codeContext =
      (questionBlock.pythonBlocks?.map(py => py.content).join('\n\n')) || '';
    const body = {
      questionText: questionBlock.prompt,
      studentAnswer,
      sampleResponse: questionBlock.samples?.[0] || '',
      feedbackPrompt: questionBlock.feedback?.[0] || '',
      followupPrompt: questionBlock.followups?.[0] || '',
      forceFollowup, // ← send it (server will mostly ignore unless you later choose to use it)
      context: {
        activitycontext: activity?.activitycontext || "Unnamed Activity",
        studentLevel: activity?.studentlevel || "intro",
      },
      guidance: [
        questionBlock.feedback?.[0] || "",     // ← per-question policy FIRST
        activity?.aicodeguidance || ""         // ← activity policy SECOND
      ].filter(Boolean).join("\n"),
      codeContext,
    };
    console.log("📝 sending guidance:", (body.guidance || "").slice(0, 200));
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
      const isPythonOnly = !!block.hasPythonOnly;

      // ---------- PYTHON-ONLY PATH ----------
      if (isPythonOnly) {
        // ✅ track attempts for this question
        const attemptsKey = `${qid}attempts`;
        const prevAttempts = Number(existingAnswers[attemptsKey]?.response || 0);

        // 0) Get current code for all code blocks of this question
        const codeBlocks = (block.pythonBlocks || []).map((py, i) => {
          const key = `${qid}code${i + 1}`;
          const ta = container.querySelector(`textarea[data-response-key="${key}"]`);
          return (ta?.value ?? existingAnswers[key]?.response ?? py.content ?? '').trim();
        });

        // 1) Require at least one change vs the starter template
        const changed = codeBlocks.some((code, i) =>
          code !== (block._initialCode?.[i] || '').trim()
        );
        if (!changed) {
          const msg = "Modify the starter program to solve the task, then run again.";
          setFollowupsShown(prev => ({ ...prev, [qid]: msg }));
          answers[`${qid}S`] = 'inprogress';
          unanswered.push(`${qid} (code not changed)`);
          codeBlocks.forEach((code, i) => answers[`${qid}code${i + 1}`] = code);
          continue;
        }
        console.log('📝 guidance being sent:', (activity?.aicodeguidance || ''));

        const studentCode = codeBlocks.join('\n\n');
        try {
          const stripHtmlLocal = (s = '') =>
            s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+>/g, '');
          const cleanLines = (s = '') =>
            stripHtmlLocal(s).replace(/^\s+/mg, '').replace(/[ \t]+$/mg, '');

          // ⬇️ build a richer, cleaned guidance blob
          const perQuestionGuide = [
            cleanLines(block.feedback?.[0] || ''),
            cleanLines(block.samples?.[0] || ''),
            'Environment constraint: f-strings are unavailable; do not suggest or use them.',
            "Explicit override: Ignore spacing in prompts and around commas; do not request changes like 'remove an extra space' if the program meets the requirements."
          ].filter(Boolean).join('\n');

          const activityGuide = [
            activity?.aicodeguidance || '',
            activity?.activitycontext || '',
            `Student level: ${activity?.studentlevel || 'intro'}`
          ].filter(Boolean).join('\n');
          
          // HARD STOP for questions with feedbackprompt/followups = none
          if (isNoAI(block?.feedback?.[0]) || isNoAI(block?.followups?.[0])) {
            // Save the code and mark the item complete without asking the AI
            codeBlocks.forEach((code, i) => answers[`${qid}code${i + 1}`] = code);
            answers[`${qid}S`] = 'completed';
            setFollowupsShown(prev => { const copy = { ...prev }; delete copy[qid]; return copy; });
            continue; // skip evaluator call
          }
          const guidanceBlob = `${perQuestionGuide}\n---\n${activityGuide}`;

          console.log('📝 guidance being sent (code submit):\n', guidanceBlob.slice(0, 800));
          console.log('GUIDE_Q:', perQuestionGuide.slice(0, 200));
          console.log('GUIDE_A:', activityGuide.slice(0, 200));
          const aiRes = await fetch(`${API_BASE_URL}/api/ai/evaluate-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              questionText: stripHtmlLocal(block.prompt || ''),
              studentCode,
              codeVersion: qid,
              guidance: guidanceBlob
            }),
          });
          // ...rest unchanged


          // ✅ handle non-200 responses explicitly
          if (!aiRes.ok) {
            const errText = await aiRes.text();
            throw new Error(`evaluate-code ${aiRes.status}: ${errText.slice(0, 200)}`);
          }

          let { feedback: fb0, followup: fu0 } = await aiRes.json();
          let feedback = fb0;
          let followup = fu0;

          // Optional: drop spacing-only nags if your guidance says to ignore spacing
          if (/ignore spacing/i.test(activity?.aicodeguidance || '')) {
            if (feedback && /\bspace|spacing\b/i.test(feedback)) feedback = null;
            if (followup && /\bspace|spacing\b/i.test(followup)) followup = null;
          }

          // Save code snapshots on submit
          codeBlocks.forEach((code, i) => answers[`${qid}code${i + 1}`] = code);

          if (!feedback && !followup) {
            // ✅ Pass
            answers[`${qid}S`] = 'completed';
            setFollowupsShown(prev => { const copy = { ...prev }; delete copy[qid]; return copy; });
            setCodeFeedbackShown(prev => ({ ...prev, [`${qid}code1`]: null }));
          } else {
            // ❌ Not yet — encourage up to 3 tries, but never get stuck
            const nextAttempts = prevAttempts + 1;
            answers[attemptsKey] = String(nextAttempts);

            // Show a banner (prefer real follow-up; otherwise show the feedback)
            const banner = followup || feedback || 'Consider refining your code.';
            setFollowupsShown(prev => ({ ...prev, [qid]: banner }));

            if (nextAttempts >= 3) {
              // ⛳ BYPASS after 3 tries: mark this item completed so the group can advance.
              answers[`${qid}S`] = 'completed';
              // (Optional) keep the banner visible to hint they could still improve.
            } else {
              // < 3 tries → keep them in this group
              answers[`${qid}S`] = 'inprogress';
              unanswered.push(`${qid} (improve code)`);
            }

            // Broadcast to other clients (inline feedback + banner)
            if (socket && instanceId) {
              socket.emit('feedback:update', {
                instanceId,
                responseKey: `${qid}code1`,
                feedback,
                followup,
              });
            }

          }

        } catch (err) {
          console.error('❌ AI code evaluation failed:', err);
          const msg = "Couldn’t check your program. Try again.";
          setFollowupsShown(prev => ({ ...prev, [qid]: msg }));
          answers[`${qid}S`] = 'inprogress';
          unanswered.push(`${qid} (evaluation error)`);
        }

        continue; // do NOT fall through
      }

      // ---------- TEXT/TABLE PATH (your existing logic) ----------
      const el = container.querySelector(`[data-question-id="${qid}"]`);
      const baseAnswer = el?.value?.trim() || '';
      const tableMarkdown = buildMarkdownTableFromBlock(block, container);

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

      const authoredFU = (block.followups?.[0] || '').trim();
      const feedbackGuide = (block.feedback?.[0] || '').trim();
      let aiInput = baseAnswer;
      if (block.hasTableResponse && tableHasInput) {
        aiInput = tableMarkdown;
        answers[qid] = tableMarkdown;     // ← push to text response slot deliberately
      }
      if (aiInput && !followupsShown[qid]) {
        // Let the server's stricter gate decide. No authored fallback.
        const aiFollowup = await evaluateResponseWithAI(block, aiInput, { forceFollowup: false });
        if (aiFollowup) {
          const baseToSave = baseAnswer || (tableHasInput ? tableMarkdown : '');
          if (baseToSave) answers[qid] = baseToSave;

          await saveResponse(instanceId, `${qid}F1`, aiFollowup);
          await saveResponse(instanceId, `${qid}S`, 'inprogress');

          setFollowupsShown(prev => ({ ...prev, [qid]: aiFollowup }));

          if (socket && instanceId) {
            socket.emit('response:update', {
              instanceId,
              responseKey: `${qid}F1`,
              value: aiFollowup,
              followupPrompt: aiFollowup
            });
          }

          alert(`A follow-up question has been added for ${qid}. Please answer it.`);
          setIsSubmitting(false);
          return;
        }
      } else {
        // ensure no stale banner if author wrote \followupprompt{none} or \feedback{none}
        setFollowupsShown(prev => {
          const next = { ...prev };
          delete next[qid];
          return next;
        });
      }


      const followupPrompt = followupsShown[qid];
      const followupKey = `${qid}FA1`;
      const followupAnswer = (followupAnswers[followupKey] || '').trim();

      let missingBase = false;
      let missingFU = false;

      if (baseAnswer) {
        answers[qid] = baseAnswer;
      } else if (tableHasInput) {
        answers[qid] = tableMarkdown;
      } else {
        missingBase = true;
        unanswered.push(`${qid} (base)`);
      }

      if (followupPrompt) {
        answers[`${qid}F1`] = followupPrompt;
        if (followupAnswer) {
          answers[followupKey] = followupAnswer;
        } else {
          missingFU = true;
          unanswered.push(`${qid} (follow-up)`);
        }
      }

      answers[`${qid}S`] = (missingBase || missingFU) ? 'inprogress' : 'completed';

      // Collect table cell answers (already above)...
    }


    // ---- NEW completion logic (drop-in replacement) ----
    const qBlocks = blocks.filter(b => b.type === 'question');
    const isCodeOnlyMap = Object.fromEntries(
      qBlocks.map(b => [`${b.groupId}${b.id}`, !!b.hasPythonOnly])
    );

    // any base text/table answers missing? (you already pushed these to `unanswered`)
    const pendingBase = unanswered.length > 0;

    // any *text/table* follow-ups that are shown but not answered?
    const pendingTextFollowups = qBlocks.some(b => {
      const qid = `${b.groupId}${b.id}`;
      if (isCodeOnlyMap[qid]) return false; // code-only uses banner, no FA1 box
      const fuShown = !!followupsShown[qid];
      if (!fuShown) return false;
      const fuAns = (followupAnswers[`${qid}FA1`]
        || existingAnswers[`${qid}FA1`]?.response
        || '').trim();
      return fuShown && !fuAns;
    });

    // any *code-only* questions that are not yet completed AND have attempts < 3?
    const pendingCodeGates = qBlocks.some(b => {
      const qid = `${b.groupId}${b.id}`;
      if (!isCodeOnlyMap[qid]) return false;
      const status = (answers[`${qid}S`] || existingAnswers[`${qid}S`]?.response || 'inprogress');
      if (status === 'completed') return false;
      const attempts = Number(answers[`${qid}attempts`]
        || existingAnswers[`${qid}attempts`]?.response
        || 0);
      return attempts < 3; // block only if fewer than 3 tries
    });

    const groupState = (pendingBase || pendingTextFollowups || pendingCodeGates)
      ? 'inprogress'
      : 'completed';

    // persist the group state as a response key the UI reads
    const stateKey = `${currentQuestionGroupIndex + 1}state`;
    answers[stateKey] = groupState;

    if (groupState === 'inprogress') {
      // only list the missing base/follow-up items; code issues are shown in the banner already
      const msg = unanswered.length
        ? `Please complete: ${unanswered.join(', ')}`
        : 'Please resolve the pending items in this group.';
      alert(msg);
      setIsSubmitting(false);
      return; // stay on this group
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
        //setFollowupsShown({});
        //setFollowupAnswers({});
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
      setIsSubmitting(false); // hide spinner after everything
    }
  }

  async function handleCodeChange(responseKey, updatedCode, meta = {}) {
    // SHORT-CIRCUIT: do not evaluate code if this question is marked none
    const baseQid = String(responseKey).replace(/code\d+$/, '');
    if (qidsNoFURef.current?.has(baseQid)) {
      // Save UI state: clear any inline/banners, don't call the AI
      socket?.emit('feedback:update', {
        instanceId,
        responseKey,
        feedback: null,
        followup: null
      });
      return;
    }

    if (!window.Sk || !skulptLoaded) {
      // Save code only; skip evaluation until Skulpt is ready
      socket?.emit('feedback:update', { instanceId, responseKey, feedback: null, followup: null });
      return;
    }
    try {
      // (1) Save code (unchanged)
      await fetch(`${API_BASE_URL}/api/responses/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: responseKey,
          activity_instance_id: instanceId,
          user_id: user?.id,
          response: updatedCode,
        }),
      });

      if (!updatedCode || !updatedCode.trim()) {
        // Save was fine, but do not ask the evaluator yet.
        socket?.emit('feedback:update', {
          instanceId,
          responseKey,
          feedback: null,
          followup: null,
        });
        return;
      }


      // ✅ Build a rich guidance blob (match what you used in handleSubmit)
      const perQuestionGuide = [
        cleanLines(meta?.feedbackPrompt || ''),
        'Environment constraint: f-strings are unavailable; do not suggest or use them.',
        "Explicit override: Ignore spacing in prompts and around commas; do not request changes like 'remove an extra space' if the program meets the requirements."
      ].filter(Boolean).join('\n');

      const activityGuide = [
        activity?.aicodeguidance || '',
        activity?.activitycontext || '',
        `Student level: ${activity?.studentlevel || 'intro'}`
      ].filter(Boolean).join('\n');

      const guidanceBlob = `${perQuestionGuide}\n---\n${activityGuide}`;


      const isCodeOnly = !meta?.hasTextResponse && !meta?.hasTableResponse;

      // (2) Call your evaluator with the richer guidance
      const qt = (meta?.questionText && meta.questionText.trim())
        ? meta.questionText.trim()
        : 'Write and run Python code.';
      console.log('GUIDE_Q:', perQuestionGuide.slice(0, 200));
      console.log('GUIDE_A:', activityGuide.slice(0, 200));
      const evalResp = await fetch(`${API_BASE_URL}/api/ai/evaluate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionText: qt,
          studentCode: updatedCode,
          codeVersion: (codeVersionsRef.current[responseKey] =
            (codeVersionsRef.current[responseKey] || 0) + 1),
          guidance: guidanceBlob,
          isCodeOnly,
        }),
      });



      if (!evalResp.ok) {
        const t = await evalResp.text();
        console.error('evaluate-code failed', evalResp.status, t);
        return;
      }

      let { feedback, followup } = await evalResp.json();

      // Optional: drop spacing-only nags if your global guidance says to ignore spacing
      if (/ignore spacing/i.test(activity?.aicodeguidance || '')) {
        if (feedback && /\bspace|spacing\b/i.test(feedback)) feedback = null;
        if (followup && /\bspace|spacing\b/i.test(followup)) followup = null;
      }

      // (3) Emit both feedback (inline) and followup (banner)
      socket?.emit('feedback:update', {
        instanceId,
        responseKey,
        feedback,  // null => hide inline suggestions
        followup,  // null => clear banner
      });
    } catch (err) {
      console.error('handleCodeChange failed:', err);
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
          codeFeedbackShown,
          isInstructor,
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
              {/* NEW: anything authored between the previous group and this one */}
              {group.prelude?.length > 0 &&
                renderBlocks(group.prelude, {
                  editable: false,
                  isActive: false,
                  mode: 'run',
                  prefill: existingAnswers,
                  currentGroupIndex: index,
                  codeFeedbackShown,
                })
              }
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
                isInstructor,
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

                  setLastEditTs(Date.now());

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
