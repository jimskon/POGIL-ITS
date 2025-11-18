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

// --- DEBUG ---
const DEBUG_FILES = false;
const PAGE_TAG = 'RUN';

// Map short role keys to full names
const roleLabels = {
  qc: 'Quality Control',
};

function isNoAI(val) {
  return String(val ?? '').trim().toLowerCase() === 'none';
}

// NEW: helper — grab current code textarea values for a question id prefix (qid like "2c")
function getCodeTextareaValues(container, qid) {
  const tAs = container.querySelectorAll(
    `textarea[data-response-key^="${qid}code"]`
  );
  return Array.from(tAs).map((ta) => (ta.value || '').trim());
}

// Infer lang for a code cell like "2acode1" by looking up the matching question block.
function getLangForResponseKey(responseKey, groups) {
  // base QID like "2c" from "2ccode1"
  const baseQid = String(responseKey).replace(/code\d+$/, '');

  // find the question block that owns this responseKey
  let found = null;
  outer: for (const g of groups) {
    for (const b of [g.intro, ...(g.content || [])]) {
      if (b?.type === 'question' && `${b.groupId}${b.id}` === baseQid) {
        found = b;
        break outer;
      }
    }
  }
  if (!found) return 'python'; // safe default

  // prefer explicit block types
  if (Array.isArray(found.cppBlocks) && found.cppBlocks.length > 0) return 'cpp';
  if (Array.isArray(found.pythonBlocks) && found.pythonBlocks.length > 0)
    return 'python';

  // generic blocks with an explicit lang field
  if (Array.isArray(found.codeBlocks) && found.codeBlocks.length > 0) {
    const lang = String(found.codeBlocks[0].lang || '').toLowerCase();
    if (lang) return lang;
  }
  return 'python';
}

function getQuestionText(block, qid) {
  const candidates = [
    block?.prompt,
    block?.content,
    block?.title,
    block?.introText,
    block?.header,
  ].filter(Boolean);
  const raw =
    candidates.find((s) => String(s).trim().length > 0) || `Question ${qid}`;
  return String(raw)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*?)?>/g, '')
    .trim();
}

function detectLanguageFromCode(code = '') {
  const s = code.trim();
  if (!s) return null;
  if (
    /\b#include\s*<[^>]+>/.test(s) ||
    /\bint\s+main\s*\(/.test(s) ||
    /std::(cout|cin|string)/.test(s)
  )
    return 'cpp';
  if (/\bdef\s+\w+\s*\(|\bprint\s*\(|^\s*#/.test(s)) return 'python';
  return null;
}

function isCodeOnlyByBlock(block) {
  const hasText = !!block?.hasTextResponse;
  const hasTable = !!block?.hasTableResponse;
  const anyCode =
    (block?.pythonBlocks?.length || 0) +
    (block?.cppBlocks?.length || 0) +
    (block?.codeBlocks?.length || 0) >
    0;
  return anyCode && !hasText && !hasTable;
}

export default function RunActivityPage({
  setRoleLabel,
  setStatusText,
  groupMembers,
  setGroupMembers,
  activeStudentId,
  setActiveStudentId,
}) {
  const [lastEditTs, setLastEditTs] = useState(0);
  const { instanceId } = useParams();
  const location = useLocation();
  const courseName = location.state?.courseName;
  const { user, loading } = useUser();
  const [followupsShown, setFollowupsShown] = useState({});
  const [followupAnswers, setFollowupAnswers] = useState({});
  const [codeFeedbackShown, setCodeFeedbackShown] = useState({});
  const [socket, setSocket] = useState(null);
  const [fileContents, setFileContents] = useState({});
  const fileContentsRef = useRef(fileContents);
  const loadingRef = useRef(false);
  const codeVersionsRef = useRef({});
  const qidsNoFURef = useRef(new Set());
  const [codeViewMode, setCodeViewMode] = useState({});
  const [localCode, setLocalCode] = useState({});

  const [activity, setActivity] = useState(null);
  const [groups, setGroups] = useState([]);
  const [activeStudentName, setActiveStudentName] = useState('');
  const [preamble, setPreamble] = useState([]);
  const [existingAnswers, setExistingAnswers] = useState({});
  const [skulptLoaded, setSkulptLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLockedFU = (qid) => qidsNoFURef.current?.has(qid);

  // compute isActive first…
  const isActive = user && user.id === activeStudentId;
  const isObserver = !isActive;

  const toggleCodeViewMode = (rk, next) =>
    setCodeViewMode((prev) => ({ ...prev, [rk]: next }));

  const updateLocalCode = (rk, code) =>
    setLocalCode((prev) => ({ ...prev, [rk]: code }));

  const isInstructor =
    user?.role === 'instructor' ||
    user?.role === 'root' ||
    user?.role === 'creator';

  const userRoles = groupMembers
    .filter((m) => String(m.student_id) === String(user.id))
    .map((m) => m.role)
    .filter(Boolean);
  const userRole =
    userRoles.length > 0
      ? userRoles.map((role) => roleLabels[role] || role).join(', ')
      : 'unknown';

  const activeStudentRoles = groupMembers
    .filter((m) => String(m.student_id) === String(activeStudentId))
    .map((m) => m.role)
    .filter(Boolean);
  const activeStudentRole =
    activeStudentRoles.length > 0
      ? activeStudentRoles.map((role) => roleLabels[role] || role).join(', ')
      : 'unknown';

  const currentQuestionGroupIndex = useMemo(() => {
    if (!existingAnswers || Object.keys(existingAnswers).length === 0) return 0;
    let count = 0;
    while (
      count < groups.length &&
      existingAnswers[`${count + 1}state`]?.response === 'completed'
    ) {
      count++;
    }
    return count;
  }, [existingAnswers, groups]);

  // NEW: test mode detection
  const isTestMode = useMemo(() => {
    if (activity?.is_test) return true;
    if (!groups || groups.length !== 1) return false;
    return groups.some((g) =>
      (g.content || []).some(
        (b) =>
          b?.type === 'question' &&
          b.scores &&
          Object.keys(b.scores).length > 0
      )
    );
  }, [activity, groups]);

  const handleUpdateFileContents = (updaterFn) => {
    setFileContents((prev) => {
      const before = Object.fromEntries(
        Object.entries(prev).map(([k, v]) => [k, (v ?? '').length])
      );
      const updated = updaterFn(prev);
      const after = Object.fromEntries(
        Object.entries(updated).map(([k, v]) => [k, (v ?? '').length])
      );
      if (DEBUG_FILES) {
        const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
        console.debug(
          `[${PAGE_TAG}] handleUpdateFileContents → changed:`,
          changed.map((k) => `${k}: ${before[k] ?? 0}→${after[k]}`)
        );
      }
      fileContentsRef.current = updated;
      return updated;
    });
  };

  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    if (!DEBUG_FILES) return;
    const sizes = Object.fromEntries(
      Object.entries(fileContents).map(([k, v]) => [k, (v ?? '').length])
    );
    console.debug(`[${PAGE_TAG}] fileContents changed:`, sizes);
  }, [fileContents]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`
        );
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
        await fetch(
          `${API_BASE_URL}/api/activity-instances/${instanceId}/heartbeat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id }),
          }
        );
      } catch { }
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 20000);
    return () => clearInterval(interval);
  }, [user?.id, instanceId]);

  useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
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
        await loadScript(
          'https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js'
        );
        await loadScript(
          'https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js'
        );
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
    const newSocket = io(API_BASE_URL);
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

  // NOTE: findQuestionBlockByQid moved *inside* component so it can see `groups`
  function findQuestionBlockByQid(qid) {
    for (const g of groups) {
      for (const b of [g.intro, ...(g.content || [])]) {
        if (b?.type === 'question' && `${b.groupId}${b.id}` === qid) return b;
      }
    }
    return null;
  }

  useEffect(() => {
    if (!socket) return;

    const handleUpdate = ({ responseKey, value, followupPrompt, answeredBy }) => {
      if (answeredBy && String(answeredBy) === String(user?.id)) return;
      if (responseKey.endsWith('FA1')) {
        const qid = responseKey.replace('FA1', '');
        if (isLockedFU(qid)) return;
        setFollowupAnswers((prev) => ({ ...prev, [responseKey]: value }));
        setFollowupsShown((prev) => ({
          ...prev,
          [qid]: followupPrompt || prev[qid] || 'Follow-up question',
        }));
      } else {
        setExistingAnswers((prev) => ({
          ...prev,
          [responseKey]: {
            ...prev[responseKey],
            response: value,
            type: 'text',
          },
        }));
      }
    };

    socket.on('response:update', handleUpdate);

    socket.on('feedback:update', ({ responseKey, feedback, followup }) => {
      setCodeFeedbackShown((prev) => ({
        ...prev,
        [responseKey]: feedback ?? null,
      }));

      const m = responseKey.match(/^(.*?)(?:code\d+)$/);
      if (!m) return;
      const qid = m[1];
      const block = findQuestionBlockByQid(qid);

      // If it's code-only: NEVER show follow-ups; guidance only.
      if (block && isCodeOnlyByBlock(block)) {
        setFollowupsShown((prev) => {
          const next = { ...prev };
          delete next[qid];
          return next;
        });
        return;
      }

      // Otherwise (text/table), allow/clear follow-ups as sent
      setFollowupsShown((prev) => {
        const next = { ...prev };
        if (typeof followup === 'string' && followup.trim()) next[qid] = followup;
        else delete next[qid];
        return next;
      });
    });

    return () => {
      socket.off('response:update', handleUpdate);
      socket.off('feedback:update');
    };
  }, [socket, groups, user?.id]);

  useEffect(() => {
    if (!isActive || !user?.id || !instanceId) return;

    const interval = setInterval(() => {
      const textToSave = {};

      for (const [key, val] of Object.entries(existingAnswers)) {
        if (val?.type === 'text' && val.response?.trim()) {
          textToSave[key] = val.response.trim();
        }
      }

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
            answers: textToSave,
          }),
        }).catch(() => { });
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [isActive, user?.id, instanceId, existingAnswers, followupAnswers]);

  useEffect(() => {
    if (!activeStudentId) return;
    const student = groupMembers.find(
      (m) => String(m.student_id) === String(activeStudentId)
    );
    if (student) {
      setActiveStudentName(student.name);
    } else {
      fetch(`${API_BASE_URL}/api/users/${activeStudentId}`)
        .then((res) => res.json())
        .then((userData) => setActiveStudentName(userData.name || '(unknown)'))
        .catch(() => setActiveStudentName('(unknown)'));
    }
  }, [activeStudentId, groupMembers]);

  useEffect(() => {
    Prism.highlightAll();
  }, [groups]);

  useEffect(() => {
    if (setRoleLabel) setRoleLabel(userRole);
    if (setStatusText)
      setStatusText(
        isActive ? 'You are the active student' : 'You are currently observing'
      );
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
        answers: { [key]: value },
      }),
    });
  }

  // ---------- TEXT UTILS ----------
  function stripHtml(s = '') {
    return String(s)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*?)?>/g, '');
  }

  function cleanLines(s = '') {
    return stripHtml(s)
      .replace(/^\s+/gm, '')
      .replace(/[ \t]+$/gm, '');
  }

  async function loadActivity() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const instanceRes = await fetch(
        `${API_BASE_URL}/api/activity-instances/${instanceId}`
      );
      let instanceData = await instanceRes.json();
      setActivity(instanceData);

      if (!instanceData.total_groups) {
        await fetch(
          `${API_BASE_URL}/api/activity-instances/${instanceId}/refresh-groups`
        );
        const updatedRes = await fetch(
          `${API_BASE_URL}/api/activity-instances/${instanceId}`
        );
        const updatedData = await updatedRes.json();
        setActivity(updatedData);
        instanceData = updatedData;
      }

      const activeRes = await fetch(
        `${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`,
        {
          credentials: 'include',
        }
      );
      const activeData = await activeRes.json();
      setActiveStudentId(activeData.activeStudentId);

      const groupRes = await fetch(
        `${API_BASE_URL}/api/groups/instance/${instanceId}`
      );
      const groupData = await groupRes.json();
      let userGroup = null;
      if (user?.id) {
        userGroup = groupData.groups.find((g) =>
          g.members.some((m) => m.student_id === user.id)
        );
      }

      if (userGroup) {
        setGroupMembers(userGroup.members);
      } else {
        const elevated =
          user?.role === 'instructor' ||
          user?.role === 'root' ||
          user?.role === 'creator';
        if (elevated) {
          const activeId = activeData?.activeStudentId;
          const activeGroup = groupData.groups.find((g) =>
            g.members.some((m) => String(m.student_id) === String(activeId))
          );
          const fallbackGroup = groupData.groups?.[0];
          setGroupMembers(
            activeGroup?.members || fallbackGroup?.members || []
          );
        }
      }

      const answersRes = await fetch(
        `${API_BASE_URL}/api/activity-instances/${instanceId}/responses`
      );
      const answersData = await answersRes.json();

      setCodeFeedbackShown((prev) => {
        const merged = { ...prev };
        for (const [qid, entry] of Object.entries(answersData)) {
          if ('python_feedback' in entry && entry.python_feedback !== undefined) {
            merged[qid] = entry.python_feedback;
          }
        }
        return merged;
      });

      setExistingAnswers((prev) => ({ ...prev, ...answersData }));

      const newFollowupsData = {};
      for (const [qid, entry] of Object.entries(answersData)) {
        if (qid.endsWith('FA1')) newFollowupsData[qid] = entry.response;
      }
      setFollowupAnswers((prev) => ({ ...prev, ...newFollowupsData }));

      // Parse Google Doc structure
      const docUrl = instanceData.sheet_url;
      if (!docUrl || docUrl === 'undefined') {
        console.warn(
          '❌ Skipping doc preview because sheet_url is missing or undefined:',
          docUrl
        );
      } else {
        const docRes = await fetch(
          `${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(
            docUrl
          )}`
        );
        const { lines } = await docRes.json();
        const blocks = parseSheetToBlocks(lines);

        const activityContextBlock = blocks.find(
          (b) => b.type === 'header' && b.tag === 'activitycontext'
        );
        const studentLevelBlock = blocks.find(
          (b) => b.type === 'header' && b.tag === 'studentlevel'
        );
        const aiCodeGuideBlock = blocks.find(
          (b) => b.type === 'header' && b.tag === 'aicodeguidance'
        );

        const activitycontext = stripHtml(activityContextBlock?.content || '');
        const studentlevel = stripHtml(studentLevelBlock?.content || '');
        const aicodeguidance = stripHtml(aiCodeGuideBlock?.content || '');

        setActivity((prev) => ({
          ...prev,
          ...instanceData,
          activitycontext,
          studentlevel,
          aicodeguidance,
        }));

        const files = {};
        for (const block of blocks) {
          if (block.type === 'file' && block.filename) {
            files[block.filename] = block.content || '';
          }
        }
        setFileContents((prev) => {
          const updated = { ...prev };
          for (const [name, content] of Object.entries(files)) {
            if (!(name in updated)) updated[name] = content ?? '';
          }
          fileContentsRef.current = updated;
          return updated;
        });

        // group/preamble logic
        const grouped = [];
        const preamble = [];
        let seenAnyGroup = false;
        let currentGroup = null;
        let betweenGroups = [];

        for (const block of blocks) {
          if (block.type === 'groupIntro') {
            if (currentGroup) grouped.push(currentGroup);
            currentGroup = { intro: block, prelude: [], content: [] };
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
            currentGroup.content.push(block);
          } else {
            if (!seenAnyGroup) preamble.push(block);
            else betweenGroups.push(block);
          }
        }
        if (currentGroup) grouped.push(currentGroup);
        if (betweenGroups.length) {
          if (grouped.length)
            grouped[grouped.length - 1].content.push(...betweenGroups);
          else preamble.push(...betweenGroups);
        }

        setGroups(grouped);

        // rebuild locked-FU set
        const noSet = new Set();
        for (const g of grouped) {
          for (const b of [g.intro, ...(g.content || [])]) {
            if (b?.type === 'question') {
              const qid = `${b.groupId}${b.id}`;
              if (
                isNoAI(b?.followups?.[0]) ||
                isNoAI(b?.feedback?.[0])
              ) {
                noSet.add(qid);
              }
            }
          }
        }
        qidsNoFURef.current = noSet;
        setPreamble(preamble);
        setFollowupsShown((prev) => {
          const next = { ...prev };
          for (const qid of qidsNoFURef.current) delete next[qid];
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to load activity data', err);
    } finally {
      loadingRef.current = false;
    }
  }

  async function evaluateResponseWithAI(
    questionBlock,
    studentAnswer,
    { forceFollowup = false } = {}
  ) {
    // NEW: no AI follow-ups during tests
    if (isTestMode) return null;

    const qid = `${questionBlock.groupId}${questionBlock.id}`;
    if (
      isLockedFU(qid) ||
      isNoAI(questionBlock?.followups?.[0]) ||
      isNoAI(questionBlock?.feedback?.[0])
    ) {
      return null;
    }
    const codeContext =
      (questionBlock.pythonBlocks
        ?.map((py) => py.content)
        .join('\n\n')) || '';
    const body = {
      questionText: questionBlock.prompt,
      studentAnswer,
      sampleResponse: questionBlock.samples?.[0] || '',
      feedbackPrompt: questionBlock.feedback?.[0] || '',
      followupPrompt: questionBlock.followups?.[0] || '',
      forceFollowup,
      context: {
        activitycontext: activity?.activitycontext || 'Unnamed Activity',
        studentLevel: activity?.studentlevel || 'intro',
      },
      guidance: [
        questionBlock.feedback?.[0] || '',
        activity?.aicodeguidance || '',
      ]
        .filter(Boolean)
        .join('\n'),
      codeContext,
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/ai/evaluate-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      return data.followupQuestion || null;
    } catch {
      return null;
    }
  }

  function buildMarkdownTableFromBlock(block, container) {
    if (!block.tableBlocks?.length) return '';
    let result = '';
    for (let t = 0; t < block.tableBlocks.length; t++) {
      const table = block.tableBlocks[t];
      result += `### ${table.title || 'Table'}\n\n`;
      const colCount = table.rows[0]?.length || 0;
      const markdownRows = [];
      for (let row = 0; row < table.rows.length; row++) {
        const cells = table.rows[row].map((cell, col) => {
          if (cell.type === 'static') return cell.content || '';
          if (cell.type === 'input') {
            const key = `${block.groupId}${block.id}table${t}cell${row}_${col}`;
            const val =
              container.querySelector(`[data-question-id="${key}"]`)
                ?.value?.trim() || '';
            return val;
          }
          return '';
        });
        markdownRows.push(`| ${cells.join(' | ')} |`);
      }
      if (markdownRows.length > 0) {
        const header = markdownRows[0];
        const separator = `| ${'--- |'.repeat(colCount)}`;
        result += [header, separator, ...markdownRows.slice(1)].join('\n') + '\n\n';
      }
    }
    return result;
  }

  // Normalize code for "changed?" checks
  function normalizeCode(s = '') {
    return String(s)
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .trim();
  }

  // Get all code blocks (Python/C++) for this question
  function collectQuestionCodeBlocks(block, qid, container, existingAnswers) {
    // Prefer parser-declared blocks…
    const totals = [
      block?.pythonBlocks?.length || 0,
      block?.cppBlocks?.length || 0,
      block?.codeBlocks?.length || 0,
    ];
    let total = totals[0] + totals[1] + totals[2];

    const result = [];

    if (total > 0) {
      for (let i = 0; i < total; i++) {
        const key = `${qid}code${i + 1}`;
        const fromState = existingAnswers[key]?.response;

        const authored =
          block.pythonBlocks?.[i]?.content ??
          block.cppBlocks?.[i]?.content ??
          block.codeBlocks?.[i]?.content ??
          '';

        let fromDOM = '';
        const ta = container?.querySelector(
          `textarea[data-response-key="${key}"]`
        );
        if (ta && typeof ta.value === 'string') fromDOM = ta.value;

        const chosen = fromState ?? fromDOM ?? authored ?? '';
        result.push({ key, code: chosen, template: authored });
      }
      return result;
    }

    // …fallback if parser didn't annotate
    const prefix = `${qid}code`;
    const keys = Object.keys(existingAnswers)
      .filter((k) => k.startsWith(prefix))
      .sort((a, b) => {
        const ai = Number(a.replace(prefix, '')) || 0;
        const bi = Number(b.replace(prefix, '')) || 0;
        return ai - bi;
      });

    if (keys.length === 0) {
      const tAs =
        container?.querySelectorAll(
          `textarea[data-response-key^="${prefix}"]`
        ) || [];
      if (tAs.length) {
        Array.from(tAs).forEach((ta, idx) => {
          const key =
            ta.getAttribute('data-response-key') || `${prefix}${idx + 1}`;
          result.push({ key, code: ta.value || '', template: '' });
        });
      } else {
        result.push({
          key: `${prefix}1`,
          code: existingAnswers[`${prefix}1`]?.response || '',
          template: '',
        });
      }
    } else {
      keys.forEach((k) => {
        result.push({
          key: k,
          code: existingAnswers[k]?.response || '',
          template: '',
        });
      });
    }

    return result;
  }

  // Treat as code-only if there's code and no text/table inputs present.
  function isCodeOnlyQuestion(block, qid, container, existingAnswers) {
    // real text input?
    const textInputEl = container?.querySelector(
      `[data-question-id="${qid}"]`
    );
    const effectiveHasText = !!textInputEl;

    // any table input cells?
    const tableInputEl = container?.querySelector(
      `[data-question-id^="${qid}table"]`
    );
    const effectiveHasTable = !!tableInputEl;

    // parser-declared code?
    const anyParserCode =
      (block?.pythonBlocks?.length || 0) +
      (block?.cppBlocks?.length || 0) +
      (block?.codeBlocks?.length || 0) >
      0;

    // DOM textareas
    const taCount = container
      ? container.querySelectorAll(
        `textarea[data-response-key^="${qid}code"]`
      ).length
      : 0;

    // existing answers
    const ansCount = Object.keys(existingAnswers || {}).filter((k) =>
      k.startsWith(`${qid}code`)
    ).length;

    const anyCode = anyParserCode || taCount > 0 || ansCount > 0;

    return anyCode && !effectiveHasText && !effectiveHasTable;
  }

  // Prefer parser hints; otherwise fallback to simple detection
  function pickLangForBlock(block, studentCode) {
    if (Array.isArray(block?.cppBlocks) && block.cppBlocks.length) return 'cpp';
    if (Array.isArray(block?.pythonBlocks) && block.pythonBlocks.length)
      return 'python';
    const generic =
      Array.isArray(block?.codeBlocks) && block.codeBlocks[0]?.lang
        ? String(block.codeBlocks[0].lang).toLowerCase()
        : null;
    return generic || detectLanguageFromCode(studentCode) || 'python';
  }

  function buildTestSubmissionPayload(blocks, container) {
    const answers = {};
    const questions = [];

    for (const block of blocks) {
      if (block.type !== 'question') continue;

      const qid = `${block.groupId}${block.id}`;
      const questionText = getQuestionText(block, qid);

      // 1) Base written/text response (if any)
      const textEl = container.querySelector(`[data-question-id="${qid}"]`);
      const baseAnswer = textEl?.value?.trim() || '';
      if (baseAnswer) {
        answers[qid] = baseAnswer;
      }

      // 2) Code cells
      const domCodeCells = getCodeTextareaValues(container, qid);
      const codeCells = domCodeCells.map((code, idx) => {
        const key = `${qid}code${idx + 1}`;
        answers[key] = code || '';
        return { key, code: code || '' };
      });

      if (codeCells.length === 0) {
        const prefix = `${qid}code`;
        const existingKeys = Object.keys(existingAnswers)
          .filter((k) => k.startsWith(prefix))
          .sort((a, b) => {
            const ai = Number(a.replace(prefix, '')) || 0;
            const bi = Number(b.replace(prefix, '')) || 0;
            return ai - bi;
          });

        existingKeys.forEach((key) => {
          const code = existingAnswers[key]?.response || '';
          answers[key] = code;
          codeCells.push({ key, code });
        });
      }

      const combinedCode = codeCells.map((c) => c.code).join('\n\n').trim();

      // 3) Harness output — gather *all* mirrors like 1aoutput1, 1aoutput2, ...
      const outputEls = container.querySelectorAll(
        `[data-output-key^="${qid}output"]`
      );

      let combinedOutput = '';
      outputEls.forEach((el) => {
        const text = (el.textContent || '').trim();
        if (text) {
          combinedOutput += (combinedOutput ? '\n' : '') + text;
        }
      });

      const outputKey = `${qid}output`;
      const outputText =
        combinedOutput ||
        (existingAnswers[outputKey]?.response || '').trim();

      if (outputText) {
        answers[outputKey] = outputText;
      }

      // 4) Question object for grader
      questions.push({
        qid,
        questionText,
        scores: block.scores || {},
        responseText: answers[qid] || '',
        codeCells,
        code: combinedCode,
        outputText,
        output: outputText,
      });
    }

    return { answers, questions };
  }




  async function handleSubmit() {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const container = document.querySelector('[data-current-group="true"]');
    if (!container) {
      alert('Error: No editable group found.');
      setIsSubmitting(false);
      return;
    }

    // Non-blocking sync of visible code edits (no AI call here)
    const codeTextareas = container.querySelectorAll('textarea[id^="sk-code-"]');
    codeTextareas.forEach((textarea) => {
      const responseKey = textarea.getAttribute('data-response-key');
      const currentCode = (textarea.value || '').trim();
      if (responseKey) {
        handleCodeChange(responseKey, currentCode, { __broadcastOnly: true });
      }
    });

    const currentGroup = groups[currentQuestionGroupIndex];
    const blocks = [currentGroup.intro, ...currentGroup.content];

    // ---------- TEST MODE PATH ----------
    if (isTestMode) {
      try {
        const { answers, questions } = buildTestSubmissionPayload(blocks, container);

        const res = await fetch(
          `${API_BASE_URL}/api/activity-instances/${instanceId}/submit-test`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              studentId: user.id,
              answers,
              questions,
            }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(
            `Test submission failed: ${err.error || 'Unknown error submitting test.'
            }`
          );
          setIsSubmitting(false);
          return;
        }

        // ✅ ALSO mark this group as completed using the old mechanism
        const qBlocks = blocks.filter((b) => b.type === 'question');
        const stateAnswers = {};

        // per-question states: e.g., "1aS", "1bS", ...
        qBlocks.forEach((b) => {
          const qid = `${b.groupId}${b.id}`;
          stateAnswers[`${qid}S`] = 'completed';
        });

        // per-group state: "1state", "2state", ...
        const stateKey = `${currentQuestionGroupIndex + 1}state`;
        stateAnswers[stateKey] = 'completed';

        // call the existing group submit endpoint just like the old code
        await fetch(
          `${API_BASE_URL}/api/activity-instances/${instanceId}/submit-group`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              groupIndex: currentQuestionGroupIndex,
              studentId: user.id,
              groupState: 'completed',
              answers: stateAnswers,
            }),
          }
        );

        // if this was the last group, mark the whole instance complete (same as old code)
        if (currentQuestionGroupIndex + 1 === groups.length) {
          await fetch(`${API_BASE_URL}/api/responses/mark-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instanceId }),
          });
        }

        await loadActivity();
        alert('Test submitted. Your answers have been recorded.');
      } catch (err) {
        console.error('❌ Test submission failed:', err);
        alert('An error occurred submitting the test.');
      } finally {
        setIsSubmitting(false);
      }
      return; // 🚪 do not run learning-mode group logic
    }

    // ---------- ORIGINAL LEARNING-MODE PATH ----------
    const answers = {};
    const unanswered = [];

    for (let block of blocks) {
      if (block.type !== 'question') continue;

      const qid = `${block.groupId}${block.id}`;
      const codeOnly = isCodeOnlyQuestion(
        block,
        qid,
        container,
        existingAnswers
      );

      // ---------- CODE-ONLY PATH ----------
      if (codeOnly) {
        const attemptsKey = `${qid}attempts`;
        const prevAttempts = Number(
          existingAnswers[attemptsKey]?.response || 0
        );

        const codeCells = collectQuestionCodeBlocks(
          block,
          qid,
          container,
          existingAnswers
        );

        let changed = false;
        if (codeCells.some((c) => c.template && c.template.length)) {
          changed = codeCells.some(
            ({ code, template }) =>
              normalizeCode(code) !== normalizeCode(template)
          );
        } else {
          changed = codeCells.some(
            ({ code }) => normalizeCode(code).length > 0
          );
        }

        if (!changed) {
          const msg =
            'Modify the starter program to solve the task, then run again.';
          setFollowupsShown((prev) => ({ ...prev, [qid]: msg }));
          answers[`${qid}S`] = 'inprogress';
          unanswered.push(`${qid} (code not changed)`);
          codeCells.forEach(({ key, code }) => (answers[key] = code));
          continue;
        }

        codeCells.forEach(({ key, code }) => (answers[key] = code));

        const studentCode = codeCells
          .map((c) => c.code || '')
          .join('\n\n')
          .trim();

        if (!studentCode) {
          const msg =
            'Please write or modify the starter code, then submit again.';
          setFollowupsShown((prev) => ({ ...prev, [qid]: msg }));
          answers[`${qid}S`] = 'inprogress';
          unanswered.push(`${qid} (no code)`);
          continue;
        }

        const qText = getQuestionText(block, qid);

        const perQuestionGuide = [
          cleanLines(block.feedback?.[0] || ''),
          cleanLines(block.samples?.[0] || ''),
        ]
          .filter(Boolean)
          .join('\n');

        const activityGuide = [
          activity?.aicodeguidance || '',
          activity?.activitycontext || '',
          `Student level: ${activity?.studentlevel || 'intro'}`,
        ]
          .filter(Boolean)
          .join('\n');

        const guidanceBlob = `${perQuestionGuide}\n---\n${activityGuide}`;

        const lang =
          detectLanguageFromCode(studentCode) ||
          pickLangForBlock(block, studentCode);

        try {
          const aiRes = await fetch(`${API_BASE_URL}/api/ai/evaluate-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              questionText: qText,
              studentCode,
              codeVersion: qid,
              guidance: guidanceBlob,
              lang,
              isCodeOnly: true,
            }),
          });

          if (!aiRes.ok) {
            const errText = await aiRes.text();
            throw new Error(
              `evaluate-code ${aiRes.status}: ${errText.slice(0, 200)}`
            );
          }

          const data = await aiRes.json();
          let feedback = String(data?.feedback ?? '').trim();
          let followup = String(data?.followup ?? '').trim();

          if (!feedback && followup) {
            feedback = followup;
            followup = '';
          }

          const targetKey =
            codeCells.find(
              (c) => normalizeCode(c.code).length > 0
            )?.key ||
            codeCells[0]?.key ||
            `${qid}code1`;

          const nextAttempts = prevAttempts + 1;
          answers[attemptsKey] = String(nextAttempts);

          if (feedback) {
            setCodeFeedbackShown((prev) => ({ ...prev, [targetKey]: feedback }));

            setFollowupsShown((prev) => {
              const x = { ...prev };
              delete x[qid];
              return x;
            });

            answers[`${qid}S`] =
              nextAttempts >= 3 ? 'completed' : 'inprogress';
            if (nextAttempts < 3)
              unanswered.push(`${qid} (improve code)`);

            if (socket && instanceId) {
              socket.emit('feedback:update', {
                instanceId,
                responseKey: targetKey,
                feedback,
                followup: null,
              });
            }
          } else {
            answers[`${qid}S`] = 'completed';

            codeCells.forEach(({ key }) => {
              setCodeFeedbackShown((prev) => ({ ...prev, [key]: null }));
            });
            setFollowupsShown((prev) => {
              const x = { ...prev };
              delete x[qid];
              return x;
            });

            if (socket && instanceId) {
              socket.emit('feedback:update', {
                instanceId,
                responseKey: targetKey,
                feedback: null,
                followup: null,
              });
            }
          }
        } catch (err) {
          console.error('❌ AI code evaluation failed:', err);
          const msg = 'Couldn’t check your program. Try again.';
          setFollowupsShown((prev) => ({ ...prev, [qid]: msg }));
          answers[`${qid}S`] = 'inprogress';
          unanswered.push(`${qid} (evaluation error)`);
        }

        continue;
      }

      // ---------- TEXT/TABLE PATH ----------
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
                const val =
                  container.querySelector(`[data-question-id="${key}"]`)
                    ?.value?.trim() || '';
                if (val !== '') {
                  answers[key] = val;
                  tableHasInput = true;
                }
              }
            }
          }
        }
      }

      const hasExistingFU = !!existingAnswers[`${qid}F1`]?.response;
      let aiInput = baseAnswer;
      if (block.hasTableResponse && tableHasInput) {
        aiInput = tableMarkdown;
        answers[qid] = tableMarkdown;
      }

      const looksCodeOnlyNow = isCodeOnlyQuestion(
        block,
        qid,
        container,
        existingAnswers
      );
      if (
        !looksCodeOnlyNow &&
        aiInput &&
        !followupsShown[qid] &&
        !isLockedFU(qid) &&
        !hasExistingFU
      ) {
        const aiFollowup = await evaluateResponseWithAI(block, aiInput, {
          forceFollowup: false,
        });
        if (aiFollowup) {
          const baseToSave =
            baseAnswer || (tableHasInput ? tableMarkdown : '');
          if (baseToSave) answers[qid] = baseToSave;

          await saveResponse(instanceId, `${qid}F1`, aiFollowup);
          await saveResponse(instanceId, `${qid}S`, 'inprogress');

          setFollowupsShown((prev) => ({ ...prev, [qid]: aiFollowup }));

          if (socket && instanceId) {
            socket.emit('response:update', {
              instanceId,
              responseKey: `${qid}F1`,
              value: aiFollowup,
              followupPrompt: aiFollowup,
            });
          }

          alert(`A follow-up question has been added for ${qid}. Please answer it.`);
          setIsSubmitting(false);
          return;
        }
      } else {
        setFollowupsShown((prev) => {
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

      answers[`${qid}S`] =
        missingBase || missingFU ? 'inprogress' : 'completed';
    }

    // ---- completion logic ----
    const qBlocks = blocks.filter((b) => b.type === 'question');

    const isCodeOnlyMap = Object.fromEntries(
      qBlocks.map((b) => {
        const qidB = `${b.groupId}${b.id}`;
        return [
          qidB,
          isCodeOnlyQuestion(b, qidB, container, existingAnswers),
        ];
      })
    );

    const pendingBase = unanswered.length > 0;

    const pendingTextFollowups = qBlocks.some((b) => {
      const qid = `${b.groupId}${b.id}`;
      if (isCodeOnlyMap[qid]) return false;
      const fuShown = !!followupsShown[qid];
      if (!fuShown) return false;
      const fuAns = (
        followupAnswers[`${qid}FA1`] ||
        existingAnswers[`${qid}FA1`]?.response ||
        ''
      ).trim();
      return fuShown && !fuAns;
    });

    const pendingCodeGates = qBlocks.some((b) => {
      const qid = `${b.groupId}${b.id}`;
      if (!isCodeOnlyMap[qid]) return false;
      const status =
        answers[`${qid}S`] ||
        existingAnswers[`${qid}S`]?.response ||
        'inprogress';
      if (status === 'completed') return false;
      const attempts = Number(
        answers[`${qid}attempts`] ||
        existingAnswers[`${qid}attempts`]?.response ||
        0
      );
      return attempts < 3;
    });

    const groupState =
      pendingBase || pendingTextFollowups || pendingCodeGates
        ? 'inprogress'
        : 'completed';

    const stateKey = `${currentQuestionGroupIndex + 1}state`;
    answers[stateKey] = groupState;

    if (groupState === 'inprogress') {
      const msg = unanswered.length
        ? `Please complete: ${unanswered.join(', ')}`
        : 'Please resolve the pending items in this group.';
      alert(msg);
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/activity-instances/${instanceId}/submit-group`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupIndex: currentQuestionGroupIndex,
            studentId: user.id,
            groupState,
            answers,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        alert(`Submission failed: ${errorData.error || 'Unknown error'}`);
      } else {
        await loadActivity();
        if (currentQuestionGroupIndex + 1 === groups.length) {
          await fetch(`${API_BASE_URL}/api/responses/mark-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instanceId }),
          });
        }
      }
    } catch (err) {
      console.error('❌ Submission failed:', err);
      alert('An error occurred during submission.');
    } finally {
      setIsSubmitting(false);
    }
  }


  async function handleCodeChange(responseKey, updatedCode, meta = {}) {
    setLastEditTs(Date.now());
    if (!isActive) return;

    setExistingAnswers((prev) => ({
      ...prev,
      [responseKey]: {
        ...(prev[responseKey] || {}),
        response: updatedCode,
        type: 'text',
      },
    }));

    socket?.emit('response:update', {
      instanceId,
      responseKey,
      value: updatedCode,
      answeredBy: user.id,
    });

    if (meta?.__broadcastOnly) return;

    const baseQid = String(responseKey).replace(/code\d+$/, '');
    if (qidsNoFURef.current?.has(baseQid)) {
      socket?.emit('feedback:update', {
        instanceId,
        responseKey,
        feedback: null,
        followup: null,
      });
      setFollowupsShown((prev) => {
        const next = { ...prev };
        delete next[baseQid];
        return next;
      });
      return;
    }

    if (!window.Sk || !skulptLoaded) {
      socket?.emit('feedback:update', {
        instanceId,
        responseKey,
        feedback: null,
        followup: null,
      });
    }

    try {
      // Save code
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

      // NEW: no live guidance during tests
      if (isTestMode) {
        socket?.emit('feedback:update', {
          instanceId,
          responseKey,
          feedback: null,
          followup: null,
        });
        return;
      }

      if (!updatedCode || !updatedCode.trim()) {
        socket?.emit('feedback:update', {
          instanceId,
          responseKey,
          feedback: null,
          followup: null,
        });
        return;
      }

      const lang = getLangForResponseKey(responseKey, groups);

      let perQuestionGuideLines = [cleanLines(meta?.feedbackPrompt || '')];
      if (lang === 'python') {
        perQuestionGuideLines.push(
          'Environment constraint: f-strings are unavailable; do not suggest or use them.',
          "Explicit override: Ignore spacing in prompts and around commas; do not request changes like 'remove an extra space' if the program meets the requirements."
        );
      }
      const perQuestionGuide = perQuestionGuideLines
        .filter(Boolean)
        .join('\n');

      const activityGuide = [
        activity?.aicodeguidance || '',
        activity?.activitycontext || '',
        `Student level: ${activity?.studentlevel || 'intro'}`,
      ]
        .filter(Boolean)
        .join('\n');

      const guidanceBlob = `${perQuestionGuide}\n---\n${activityGuide}`;

      const isCodeOnlyQ = !meta?.hasTextResponse && !meta?.hasTableResponse;

      const qt =
        meta?.questionText && meta.questionText.trim()
          ? meta.questionText.trim()
          : 'Write and run code.';

      const evalResp = await fetch(`${API_BASE_URL}/api/ai/evaluate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionText: qt,
          studentCode: updatedCode,
          codeVersion: (codeVersionsRef.current[responseKey] =
            (codeVersionsRef.current[responseKey] || 0) + 1),
          guidance: guidanceBlob,
          isCodeOnly: isCodeOnlyQ,
          lang,
        }),
      });

      if (!evalResp.ok) {
        return;
      }

      const data = await evalResp.json();
      let feedback = String(data?.feedback ?? '').trim();
      let followup = String(data?.followup ?? '').trim();

      if (!feedback && followup) {
        feedback = followup;
        followup = '';
      }

      if (feedback) {
        setCodeFeedbackShown((prev) => ({ ...prev, [responseKey]: feedback }));
      } else {
        setCodeFeedbackShown((prev) => ({ ...prev, [responseKey]: null }));
      }

      const baseQid2 = String(responseKey).replace(/code\d+$/, '');
      setFollowupsShown((prev) => {
        const x = { ...prev };
        delete x[baseQid2];
        return x;
      });

      socket?.emit('feedback:update', {
        instanceId,
        responseKey,
        feedback: feedback || null,
        followup: null,
      });
    } catch (err) {
      console.error('handleCodeChange failed:', err);
    }
  }
  // Helper: pull score + explain fields for a base question id like "1a"
   // Helper: pull tri-band scores + feedback for a base question id like "1a"
  function getQuestionScores(qid, block) {
    const codeScoreRaw =
      existingAnswers[`${qid}CodeScore`]?.response ??
      existingAnswers[`${qid}codeScore`]?.response;

    const runScoreRaw =
      existingAnswers[`${qid}RunScore`]?.response ??
      existingAnswers[`${qid}runScore`]?.response;

    const respScoreRaw =
      existingAnswers[`${qid}ResponseScore`]?.response ??
      existingAnswers[`${qid}responseScore`]?.response;

    const codeScore = codeScoreRaw != null ? Number(codeScoreRaw) : null;
    const runScore  = runScoreRaw  != null ? Number(runScoreRaw)  : null;
    const respScore = respScoreRaw != null ? Number(respScoreRaw) : null;

    const codeExplain =
      existingAnswers[`${qid}CodeFeedback`]?.response ||
      existingAnswers[`${qid}CodeExplain`]?.response ||
      "";

    const runExplain =
      existingAnswers[`${qid}RunFeedback`]?.response ||
      existingAnswers[`${qid}RunExplain`]?.response ||
      "";

    const respExplain =
      existingAnswers[`${qid}ResponseFeedback`]?.response ||
      existingAnswers[`${qid}ResponseExplain`]?.response ||
      "";

    const bucketPoints = (bucket) => {
      if (!bucket) return 0;
      if (typeof bucket === "number") return bucket;
      if (typeof bucket === "object" && typeof bucket.points === "number") {
        return bucket.points;
      }
      return 0;
    };

    const scores = block?.scores || {};
    const maxCode = bucketPoints(scores.code);
    const maxRun  = bucketPoints(scores.output);
    const maxResp = bucketPoints(scores.response);

    const hasAnyScore =
      codeScoreRaw != null ||
      runScoreRaw  != null ||
      respScoreRaw != null ||
      existingAnswers.hasOwnProperty(`${qid}CodeScore`) ||
      existingAnswers.hasOwnProperty(`${qid}RunScore`) ||
      existingAnswers.hasOwnProperty(`${qid}ResponseScore`);

    const earnedTotal =
      (codeScore != null ? codeScore : 0) +
      (runScore  != null ? runScore  : 0) +
      (respScore != null ? respScore : 0);

    const maxTotal = maxCode + maxRun + maxResp;

    return {
      hasAnyScore,
      codeScore,
      runScore,
      respScore,
      codeExplain,
      runExplain,
      respExplain,
      maxCode,
      maxRun,
      maxResp,
      earnedTotal,
      maxTotal,
    };
  }

  return (
    <>
      <Container className="pt-3 mt-2">
        <h2>
          {activity?.title
            ? `Activity: ${activity.title}`
            : courseName
              ? `Course: ${courseName}`
              : 'Untitled Activity'}
        </h2>

        {renderBlocks(preamble, {
          editable: false,
          isActive: false,
          mode: 'run',
          codeFeedbackShown,
          isInstructor,
          allowLocalToggle: true,
          isObserver: !isActive,
          codeViewMode,
          onToggleViewMode: toggleCodeViewMode,
          localCode,
          onLocalCodeChange: updateLocalCode,
          prefill: existingAnswers,
        })}

        {groups.map((group, index) => {
          const stateKey = `${index + 1}state`;
          const isComplete =
            existingAnswers[stateKey]?.response === 'completed';
          const isCurrent = index === currentQuestionGroupIndex;

          const editable = isActive && isCurrent && !isComplete;
          const showGroup = isInstructor || isComplete || isCurrent;
          if (!showGroup) return null;

          return (
            <div
              key={`group-${index}`}
              className="mb-4"
              data-current-group={editable ? 'true' : undefined}
            >
              {group.prelude?.length > 0 &&
                renderBlocks(group.prelude, {
                  editable: false,
                  isActive: false,
                  mode: 'run',
                  prefill: existingAnswers,
                  currentGroupIndex: index,
                  codeFeedbackShown,
                })}

              <p>
                <strong>{index + 1}.</strong> {group.intro.content}
              </p>

              {DEBUG_FILES &&
                console.debug(
                  `[${PAGE_TAG}] renderBlocks(group ${index + 1}) file sizes:`,
                  Object.fromEntries(
                    Object.entries(fileContents).map(([k, v]) => [
                      k,
                      (v ?? '').length,
                    ])
                  )
                )}

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
                allowLocalToggle: true,
                isObserver,
                codeViewMode,
                onToggleViewMode: toggleCodeViewMode,
                localCode,
                onLocalCodeChange: updateLocalCode,
                onTextChange: (responseKey, value) => {
                  if (responseKey.endsWith('FA1')) {
                    setFollowupAnswers((prev) => ({
                      ...prev,
                      [responseKey]: value,
                    }));
                  } else {
                    setExistingAnswers((prev) => ({
                      ...prev,
                      [responseKey]: {
                        ...prev[responseKey],
                        response: value,
                        type: 'text',
                      },
                    }));
                  }
                  if (isActive && socket) {
                    socket.emit('response:update', {
                      instanceId,
                      responseKey,
                      value,
                      answeredBy: user.id,
                    });
                  }
                  setLastEditTs(Date.now());
                },
              })}
              {/* Show per-question scores + AI explanations in TEST MODE */}
              {isTestMode && (
                <div className="mt-3">
                  {group.content
                    .filter((b) => b.type === 'question')
                    .map((b) => {
                      const qid = `${b.groupId}${b.id}`;
                      const {
                        hasAnyScore,
                        respScore,
                        codeScore,
                        totalScore,
                        respExplain,
                        codeExplain,
                        totalExplain,
                      } = getQuestionScores(qid);

                      if (!hasAnyScore) return null;

                      return (
                        <div
                          key={`${qid}-scores`}
                          className="mt-2 p-2 border rounded bg-light"
                        >
                          <strong>Question {qid} – Score: </strong>
                          {totalScore ||
                            [
                              respScore && `Written ${respScore}`,
                              codeScore && `Code ${codeScore}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}

                          {respExplain && (
                            <div className="mt-1 small">
                              <strong>Written/output feedback:</strong>{' '}
                              <span style={{ whiteSpace: 'pre-wrap' }}>
                                {respExplain}
                              </span>
                            </div>
                          )}

                          {codeExplain && (
                            <div className="mt-1 small">
                              <strong>Code feedback:</strong>{' '}
                              <span style={{ whiteSpace: 'pre-wrap' }}>
                                {codeExplain}
                              </span>
                            </div>
                          )}

                          {totalExplain && (
                            <div className="mt-1 small">
                              <strong>Overall comment:</strong>{' '}
                              <span style={{ whiteSpace: 'pre-wrap' }}>
                                {totalExplain}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              {editable && (
                <div className="mt-2">
                  <Button onClick={handleSubmit} disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Spinner
                          animation="border"
                          size="sm"
                          className="me-2"
                        />
                        Loading...
                      </>
                    ) : isTestMode ? (
                      'Submit Test'
                    ) : (
                      'Submit and Continue'
                    )}
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {groups.length > 0 &&
          currentQuestionGroupIndex === groups.length && (
            <Alert variant="success">
              All questions complete! Review your responses above.
            </Alert>
          )}
      </Container>

      {DEBUG_FILES && (
        <div className="small text-muted" style={{ whiteSpace: 'pre-wrap' }}>
          <strong>🧪 Files:</strong>{' '}
          {Object.keys(fileContents).length === 0
            ? '(none)'
            : Object.entries(fileContents)
              .map(([k, v]) => `${k}(${(v ?? '').length})`)
              .join(', ')}
        </div>
      )}
    </>
  );
}
