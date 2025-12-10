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
import { parseUtcDbDatetime } from '../utils/time';

import RunActivityTestStatusBanner from '../components/RunActivityTestStatusBanner';
import RunActivityFloatingTimer from '../components/RunActivityFloatingTimer';
import QuestionScorePanel from '../components/QuestionScorePanel';


// --- DEBUG ---
const DEBUG_FILES = false;
const PAGE_TAG = 'RUN';

// Map short role keys to full names
const roleLabels = {
  qc: 'Quality Control',
};

// Normalize question / group status strings
const normalizeStatus = (raw) =>
  raw === 'completed' ? 'complete' : (raw || 'inprogress');

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

// NEW: pretty formatting for countdown
function formatRemainingSeconds(sec) {
  if (sec == null || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
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
  const [textFeedbackShown, setTextFeedbackShown] = useState({});

  // per-group “ignore AI, let me continue” overrides
  const [overrideGroups, setOverrideGroups] = useState({});

  // NEW: test timing lock state + auto-submit guard
  const [testLockState, setTestLockState] = useState({
    lockedBefore: false,
    lockedAfter: false,
    remainingSeconds: null,
  });
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  const isLockedFU = (qid) => qidsNoFURef.current?.has(qid);



  const toggleCodeViewMode = (rk, next) =>
    setCodeViewMode((prev) => ({ ...prev, [rk]: next }));

  const updateLocalCode = (rk, code) =>
    setLocalCode((prev) => ({ ...prev, [rk]: code }));

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

    while (count < groups.length) {
      const raw = existingAnswers[`${count + 1}state`]?.response;
      const status = normalizeStatus(raw);

      if (status !== 'complete') break;
      count++;
    }

    return count;
  }, [existingAnswers, groups]);


  const isTestMode = useMemo(() => {
    // Primary: any instance with a time window is a test
    if (
      activity?.test_start_at &&
      Number(activity?.test_duration_minutes) > 0
    ) {
      return true;
    }

    // Secondary: explicit DB flag, once we start storing it
    if (activity?.is_test) return true;

    // Fallback heuristic (only if we *really* don't know)
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

  useEffect(() => {
    console.log('[RUN] isTestMode:', isTestMode);
  }, [isTestMode]);

  const isInstructor =
    user?.role === 'instructor' ||
    user?.role === 'root' ||
    user?.role === 'creator';
  const isStudent = user?.role === 'student';

  // In test mode, every student is their own "active" user.
  // In POGIL mode, only the activeStudentId is editable.
  const isActive =
    !!user &&
    (
      (isTestMode && isStudent) ||
      (activeStudentId != null && String(user.id) === String(activeStudentId))
    );

  const isObserver = !isActive;
  // NEW: compute test window from activity fields (if present)
  const testWindow = useMemo(() => {
    if (!isTestMode) return null;

    const startStr = activity?.test_start_at;
    const dur = activity?.test_duration_minutes;
    if (!startStr || !dur) return null;

    const start = parseUtcDbDatetime(startStr);
    if (!start) return null;

    let end = new Date(start.getTime() + Number(dur) * 60 * 1000);

    if (activity?.test_reopen_until) {
      const reopen = parseUtcDbDatetime(activity.test_reopen_until);
      if (reopen && reopen > end) {
        end = reopen;
      }
    }

    return { start, end };
  }, [
    isTestMode,
    activity?.test_start_at,
    activity?.test_duration_minutes,
    activity?.test_reopen_until,
  ]);
  useEffect(() => {
    console.log('[RUN] testWindow:', testWindow);
  }, [testWindow]);

  useEffect(() => {
    if (!socket || !instanceId) return;

    const handleFileUpdate = ({ instanceId: msgId, filename, value }) => {
      if (String(msgId) !== String(instanceId)) return;

      setFileContents((prev) => {
        const updated = { ...prev, [filename]: value };
        fileContentsRef.current = updated;

        if (DEBUG_FILES) {
          console.debug(
            `[${PAGE_TAG}] socket file:update → ${filename}: ${(prev[filename] ?? '').length}→${(value ?? '').length}`
          );
        }

        return updated;
      });
    };

    socket.on('file:update', handleFileUpdate);
    return () => {
      socket.off('file:update', handleFileUpdate);
    };
  }, [socket, instanceId]);

  /* useEffect(() => {
     if (!isTestMode || !testWindow) {
       setTestLockState({
         lockedBefore: false,
         lockedAfter: false,
         remainingSeconds: null,
       });
       return;
     }
 
     const hasSubmitted = !!activity?.submitted_at;
     const { start, end } = testWindow;
 
     const update = () => {
       const now = new Date();
 
       let lockedBefore = false;
       let lockedAfter = hasSubmitted;
       let remainingSeconds = null;
 
       if (!lockedAfter) {
         if (now < start && !hasSubmitted) {
           // Before start window
           lockedBefore = true;
           lockedAfter = false;
           remainingSeconds = Math.floor(
             (start.getTime() - now.getTime()) / 1000
           );
         } else {
           // Inside or after window
           const diff = Math.floor((end.getTime() - now.getTime()) / 1000);
           remainingSeconds = diff > 0 ? diff : 0;
           lockedBefore = false;
 
           // IMPORTANT:
           // - While time remains, we keep lockedAfter = false.
           // - When time has run out (diff <= 0) *and* not yet submitted,
           //   we leave lockedAfter = false but remainingSeconds = 0.
           //   That gives the auto-submit effect a chance to run.
           // - Once submitted (hasSubmitted true in a later tick), we lock it.
           if (hasSubmitted) {
             lockedAfter = true;
           }
         }
 
       } else {
         remainingSeconds = 0;
       }
 
       setTestLockState({ lockedBefore, lockedAfter, remainingSeconds });
     };
 
     update();
     const id = setInterval(update, 1000);
     return () => clearInterval(id);
   }, [isTestMode, testWindow, activity?.submitted_at]);*/


  // NEW: if aicodeguidance says "Follow-ups: requirements-only", don't gate on AI feedback
  const isRequirementsOnly = useMemo(() => {
    const g = activity?.aicodeguidance || '';
    return /follow-ups:\s*requirements-only/i.test(g);
  }, [activity?.aicodeguidance]);

  // ✅ NEW: overall totals useMemo
  const overallTestTotals = useMemo(() => {
    if (!isTestMode || !groups || groups.length === 0) {
      return { earned: 0, max: 0 };
    }

    let earned = 0;
    let max = 0;

    for (const g of groups) {
      for (const b of g.content || []) {
        if (b?.type !== 'question') continue;
        const qid = `${b.groupId}${b.id}`;
        const { hasAnyScore, earnedTotal, maxTotal } = getQuestionScores(qid, b);
        if (!hasAnyScore) continue;
        if (Number.isFinite(earnedTotal)) earned += earnedTotal;
        if (Number.isFinite(maxTotal)) max += maxTotal;
      }
    }
    return { earned, max };
  }, [isTestMode, groups, existingAnswers]);

  const handleUpdateFileContents = (updaterFn) => {
    setFileContents((prev) => {
      const before = Object.fromEntries(
        Object.entries(prev).map(([k, v]) => [k, (v ?? '').length])
      );
      const updated = updaterFn(prev);
      const after = Object.fromEntries(
        Object.entries(updated).map(([k, v]) => [k, (v ?? '').length])
      );

      const changed = Object.keys(after).filter((k) => before[k] !== after[k]);

      if (DEBUG_FILES) {
        console.debug(
          `[${PAGE_TAG}] handleUpdateFileContents → changed:`,
          changed.map((k) => `${k}: ${before[k] ?? 0}→${after[k]}`)
        );
      }

      fileContentsRef.current = updated;

      // 🔄 Broadcast programmatic changes (Python writes)
      if (isActive && socket && instanceId && changed.length > 0) {
        changed.forEach((filename) => {
          socket.emit('file:update', {
            instanceId,
            fileKey: `file:${filename}`,
            filename,
            value: updated[filename] ?? '',
          });
        });
      }

      // 💾 NEW: persist programmatic writes too
      if (isActive && instanceId && user?.id && changed.length > 0) {
        const answers = {};
        changed.forEach((filename) => {
          answers[`file:${filename}`] = updated[filename] ?? '';
        });

        fetch(`${API_BASE_URL}/api/responses/bulk-save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceId,
            userId: user.id,
            answers,
          }),
        }).catch(() => { });
      }

      return updated;
    });
  };

  // For manual edits in <FileBlock> textareas
  // For manual edits in <FileBlock> textareas
  const handleFileChange = (fileKey, newText, meta = {}) => {
    const filename = meta.filename || fileKey;

    // Update local canonical file contents
    setFileContents((prev) => {
      const updated = { ...prev, [filename]: newText };
      fileContentsRef.current = updated;

      if (DEBUG_FILES) {
        console.debug(
          `[${PAGE_TAG}] handleFileChange → ${filename}: ${(prev[filename] ?? '').length}→${(newText ?? '').length}`
        );
      }

      return updated;
    });

    // 🔄 Broadcast live to observers (if your server handles 'file:update')
    if (isActive && socket && instanceId) {
      socket.emit('file:update', {
        instanceId,
        fileKey,
        filename,
        value: newText,
      });
    }

    // 💾 NEW: persist file contents in responses table
    if (isActive && instanceId && user?.id) {
      // question_id pattern: file:<filename>
      saveResponse(instanceId, `file:${filename}`, newText).catch(() => { });
    }
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

  // NOTE: findQuestionBlockByQid moved inside component so it can see `groups`
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

      // Just mirror base text answers (no more FA1 special-casing)
      setExistingAnswers((prev) => ({
        ...prev,
        [responseKey]: {
          ...prev[responseKey],
          response: value,
          type: 'text',
        },
      }));
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

  // NEW: auto-submit at time 0 for active student in test mode
  /*useEffect(() => {
    if (!isTestMode) return;
    if (!isStudent) return;
    if (!isActive) return;
    if (!testWindow) return;
    if (autoSubmitted) return;

    if (testLockState.lockedAfter) return;
    if (testLockState.remainingSeconds !== 0) return;

    (async () => {
      try {
        setAutoSubmitted(true);
        await handleSubmit(false);
      } catch (err) {
        console.error('Auto-submit failed:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isTestMode,
    isStudent,
    isActive,
    testWindow,
    testLockState.remainingSeconds,
    testLockState.lockedAfter,
    autoSubmitted,
  ]);*/

  useEffect(() => {
    // If this isn’t a test or we don’t know the window yet, clear any locks.
    if (!isTestMode || !testWindow) {
      setTestLockState({
        lockedBefore: false,
        lockedAfter: false,
        remainingSeconds: null,
      });
      return;
    }

    // Only students care about lock state + auto-submit.
    // Instructors can see everything regardless.
    const isSubmitted = !!activity?.submitted_at;

    const { start, end } = testWindow;

    let autoFired = false;


    const tick = async () => {
      const now = new Date();

      let lockedBefore = false;
      let lockedAfter = isSubmitted;
      let remainingSeconds = null;

      if (!isSubmitted) {
        if (now < start) {
          // Before the test window opens
          lockedBefore = true;
          lockedAfter = false;
          remainingSeconds = Math.floor((start.getTime() - now.getTime()) / 1000);
        } else {
          // During or after the test window
          const diff = Math.floor((end.getTime() - now.getTime()) / 1000);
          remainingSeconds = diff > 0 ? diff : 0;

          // Time’s up: trigger auto-submit once for the active student
          if (diff <= 0 && !autoFired && isStudent && isActive && !autoSubmitted) {
            autoFired = true;
            setAutoSubmitted(true);
            try {
              await handleSubmit(false);
            } catch (err) {
              console.error('Auto-submit failed:', err);
            }
          }

          // After end of window, lock the test
          if (diff <= 0 || autoSubmitted || activity?.submitted_at) {
            lockedAfter = true;
          }
        }
      } else {
        // Already submitted; fully locked
        lockedAfter = true;
        remainingSeconds = 0;
      }

      setTestLockState({ lockedBefore, lockedAfter, remainingSeconds });
    };

    // Run once immediately and then every second
    tick();
    const id = setInterval(() => {
      // We intentionally ignore the promise returned by tick here
      tick();
    }, 1000);

    return () => clearInterval(id);
  }, [
    isTestMode,
    testWindow,
    isStudent,
    isActive,
    autoSubmitted,
    activity?.submitted_at,
  ]);


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

      // 1) Merge into existingAnswers so renderBlocks can prefill
      setExistingAnswers((prev) => ({ ...prev, ...answersData }));

      // 💾 NEW: hydrate fileContents from saved file:<filename> responses
const savedFiles = {};
for (const [key, entry] of Object.entries(answersData)) {
  if (!key.startsWith('file:')) continue;
  const filename = key.slice('file:'.length);
  if (!filename) continue;
  savedFiles[filename] = entry?.response ?? '';
}

if (Object.keys(savedFiles).length > 0) {
  setFileContents((prev) => {
    const updated = { ...prev, ...savedFiles };
    fileContentsRef.current = updated;

    if (DEBUG_FILES) {
      console.debug(
        `[${PAGE_TAG}] hydrate files from DB:`,
        Object.entries(savedFiles).map(([k, v]) => `${k}(${(v ?? '').length})`)
      );
    }

    return updated;
  });
}


      // 2) Restore code feedback (per-code-cell feedback from backend)
      setCodeFeedbackShown((prev) => {
        const merged = { ...prev };
        for (const [key, entry] of Object.entries(answersData)) {
          if (
            entry &&
            Object.prototype.hasOwnProperty.call(entry, 'python_feedback')
          ) {
            merged[key] = entry.python_feedback;
          }
        }
        return merged;
      });

      // 3) Restore text AI guidance from saved F1 entries (e.g., "2aF1" → question "2a"),
      //    but only if we're NOT in "requirements-only" mode.
      if (!isRequirementsOnly) {
        const restoredTextFeedback = {};

        for (const [key, entry] of Object.entries(answersData)) {
          if (!key.endsWith('F1')) continue;      // keys like "2aF1"
          const baseQid = key.slice(0, -2);       // "2aF1" → "2a"
          const text = (entry?.response || '').trim();
          if (text) {
            restoredTextFeedback[baseQid] = text;
          }
        }

        if (Object.keys(restoredTextFeedback).length > 0) {
          setTextFeedbackShown((prev) => ({
            ...prev,
            ...restoredTextFeedback,
          }));
        }
      }

      // 4) Restore stored follow-up *answers* (e.g., "2aFA1"), if you ever use them
      const restoredFollowups = {};
      for (const [key, entry] of Object.entries(answersData)) {
        if (!key.endsWith('FA1')) continue;
        const text = (entry?.response || '').trim();
        if (text) {
          restoredFollowups[key] = text;
        }
      }
      if (Object.keys(restoredFollowups).length > 0) {
        setFollowupAnswers((prev) => ({ ...prev, ...restoredFollowups }));
      }


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
    // NEW: no AI feedback during tests
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
      (questionBlock.pythonBlocks?.map((py) => py.content).join('\n\n')) || '';

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

      // Treat either feedback or followupQuestion as a single feedback blob
      const feedback =
        (data.feedback && String(data.feedback).trim()) ||
        (data.followupQuestion && String(data.followupQuestion).trim()) ||
        '';

      return feedback || null;
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

    // 2) Table inputs (if any)
    let tableHasInput = false;
    let tableMarkdown = '';

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

      if (tableHasInput) {
        // Build a markdown snapshot of the student's table for grading
        tableMarkdown = buildMarkdownTableFromBlock(block, container);
      }
    }

    // 3) Harness output — gather mirrors like 1aoutput1, 1aoutput2, ...
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

    // 4) Collect code cells for this question
    const rawCodeCells = collectQuestionCodeBlocks(
      block,
      qid,
      container,
      existingAnswers
    );

    // Save each code cell into answers as well (so it’s snapshotted)
    rawCodeCells.forEach(({ key, code }) => {
      answers[key] = code || '';
    });

    // Shape for the grader: only keep non-empty code cells, with lang + label
    const codeCells = rawCodeCells
      .map(({ key, code }) => {
        const src = code || '';
        return {
          code: src,
          lang: pickLangForBlock(block, src),
          label: key,      // lets the grader know which cell this is
        };
      })
      .filter((c) => c.code.trim() !== '');

    // 5) Decide what becomes the "responseText" for grading
    //    Priority: written -> table -> output
    const finalResponse = baseAnswer || tableMarkdown || outputText || '';

    if (finalResponse) {
      // Store main response for this question under its qid
      answers[qid] = finalResponse;
    }

    // 6) Push question object for gradeTestQuestion
    questions.push({
      qid,
      questionText,
      scores: block.scores || {},
      responseText: finalResponse,
      codeCells,
      outputText,
      // rubric: block.scores || {}, // optional; gradeTestQuestion already falls back to scores
    });
  }

  return { answers, questions };
}



  async function handleSubmit(forceOverride = false) {
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
        const { answers, questions } = buildTestSubmissionPayload(
          blocks,
          container
        );

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

      // ---- Gather table inputs & save them ----
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

      // Determine what gets evaluated as the "answer"
      let aiInput = baseAnswer;
      if (block.hasTableResponse && tableHasInput) {
        aiInput = tableMarkdown;
      }

      // If nothing at all was entered → required
      if (!aiInput) {
        unanswered.push(`${qid} (base)`);
        answers[`${qid}S`] = 'inprogress';

        // also clear any old suggestion
        setTextFeedbackShown((prev) => {
          const next = { ...prev };
          delete next[qid];
          return next;
        });

        continue;
      }

      // Save the main answer (text or table) to DB payload
      answers[qid] = baseAnswer || tableMarkdown;

      // ---- AI suggestion gating ----
      let suggestion = textFeedbackShown[qid] || null;

      const looksCodeOnlyNow = isCodeOnlyQuestion(
        block,
        qid,
        container,
        existingAnswers
      );

      if (!looksCodeOnlyNow && !isLockedFU(qid) && !isTestMode) {
        const aiSuggestion = await evaluateResponseWithAI(block, aiInput, {
          forceFollowup: false,
        });

        if (aiSuggestion && aiSuggestion.trim()) {
          suggestion = aiSuggestion.trim();

          setTextFeedbackShown((prev) => ({
            ...prev,
            [qid]: suggestion,
          }));

          if (!isRequirementsOnly) {
            await saveResponse(instanceId, `${qid}F1`, suggestion);
          }
        } else {
          suggestion = null;

          setTextFeedbackShown((prev) => {
            const next = { ...prev };
            delete next[qid];
            return next;
          });

          if (!isRequirementsOnly) {
            await saveResponse(instanceId, `${qid}F1`, '');
          }
        }
      }



      // ---- Completion for this question ----
      answers[`${qid}S`] = suggestion ? 'inprogress' : 'completed';

      if (suggestion) {
        unanswered.push(`${qid} (AI feedback)`);
      }
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

    // TEXT AI gating: use textFeedbackShown instead of followupsShown
    const pendingTextFollowups = qBlocks.some((b) => {
      const qid = `${b.groupId}${b.id}`;
      if (isCodeOnlyMap[qid]) return false;

      const suggestion = textFeedbackShown[qid];

      const status = normalizeStatus(
        answers[`${qid}S`] ?? existingAnswers[`${qid}S`]?.response
      );

      // Pending if there is an AI suggestion and the question isn't marked complete
      return !!suggestion && status !== 'complete';
    });

    const pendingCodeGates = qBlocks.some((b) => {
      const qid = `${b.groupId}${b.id}`;
      if (!isCodeOnlyMap[qid]) return false;

      const status = normalizeStatus(
        answers[`${qid}S`] ?? existingAnswers[`${qid}S`]?.response
      );
      if (status === 'complete') return false;

      const attempts = Number(
        answers[`${qid}attempts`] ??
        existingAnswers[`${qid}attempts`]?.response ??
        0
      );
      return attempts < 3;
    });

    // In "requirements-only" mode, AI feedback is advisory, not a gate
    const effectiveTextPending = isRequirementsOnly
      ? false
      : pendingTextFollowups;
    const effectiveCodePending = isRequirementsOnly
      ? false
      : pendingCodeGates;

    const overrideThisGroup =
      forceOverride || !!overrideGroups[currentQuestionGroupIndex];

    const hasAIFromThisRun = unanswered.some((u) =>
      /\(AI feedback\)/.test(u)
    );

    const computedState =
      overrideThisGroup ||
        (!pendingBase && !effectiveTextPending && !effectiveCodePending)
        ? 'completed'
        : 'inprogress';

    const stateKey = `${currentQuestionGroupIndex + 1}state`;
    answers[stateKey] = computedState;

    if (computedState === 'inprogress') {
      const msgParts = [];

      if (unanswered.length) {
        msgParts.push(`Please complete: ${unanswered.join(', ')}.`);
      }

      if ((effectiveTextPending || hasAIFromThisRun) && !isRequirementsOnly) {
        msgParts.push(
          'There are AI suggestions (yellow boxes) for one or more questions. ' +
          'You can revise your answers and submit again, or click ' +
          '"Continue without fixing AI feedback" to move on.'
        );
      }

      if (effectiveCodePending && !isRequirementsOnly) {
        msgParts.push(
          'One or more code questions still have issues according to the code checker. ' +
          'Try improving your program and submit again, or ask your instructor about overriding.'
        );
      }

      if (msgParts.length === 0) {
        msgParts.push('There are still items to review in this group.');
      }

      alert(msgParts.join(' '));
      setIsSubmitting(false);
      return;
    }

    if (
      computedState === 'completed' &&
      overrideThisGroup &&
      (pendingBase || pendingTextFollowups || pendingCodeGates)
    ) {
      alert(
        'You chose to continue without fixing AI feedback. ' +
        'Your instructor may review this later.'
      );
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
            groupState: computedState,
            answers,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        alert(`Submission failed: ${errorData.error || 'Unknown error'}`);
      } else {
        await loadActivity();
        if (!isTestMode && overrideThisGroup) {
          // Clear any lingering AI suggestions for this group on the client side
          const qBlocksForGroup = blocks.filter((b) => b.type === 'question');
          setTextFeedbackShown((prev) => {
            const next = { ...prev };
            qBlocksForGroup.forEach((b) => {
              const qid = `${b.groupId}${b.id}`;
              delete next[qid];
            });
            return next;
          });
        }

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

    // Instructor override: save edited per-question scores & feedback
  async function handleSaveQuestionScores(qid, local) {
    if (!activity || !instanceId || !user?.id) return;

    const answers = {};

    // Normalize numeric scores (allow blank to mean "no score")
    const toNumOrNull = (val) => {
      if (val === '' || val == null) return '';
      const n = Number(val);
      return Number.isNaN(n) ? '' : String(n);
    };

    answers[`${qid}ResponseScore`] = toNumOrNull(local.respScore);
    answers[`${qid}RunScore`] = toNumOrNull(local.runScore);
    answers[`${qid}CodeScore`] = toNumOrNull(local.codeScore);

    // Free-text feedback
    answers[`${qid}ResponseFeedback`] = local.respExplain ?? '';
    answers[`${qid}RunFeedback`] = local.runExplain ?? '';
    answers[`${qid}CodeFeedback`] = local.codeExplain ?? '';

    try {
      // Persist overrides to DB
      await fetch(`${API_BASE_URL}/api/responses/bulk-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId,
          userId: user.id,
          answers,
        }),
      });

      // Update local state so UI reflects changes immediately
      setExistingAnswers((prev) => {
        const next = { ...prev };

        Object.entries(answers).forEach(([key, value]) => {
          next[key] = {
            ...(next[key] || {}),
            response: value,
            type: 'text',
          };
        });

        return next;
      });

      // Optionally you could recompute overall totals or reload activity,
      // but typically this is enough:
      // await loadActivity();   // <- if you want to be extra sure

      alert(`Saved updated scores/feedback for ${qid}.`);
    } catch (err) {
      console.error('Failed to save question scores:', err);
      alert('Error saving updated scores. Please try again.');
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

  // Helper: tri-band scores + feedback for a base question id like "1a"
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
    const runScore = runScoreRaw != null ? Number(runScoreRaw) : null;
    const respScore = respScoreRaw != null ? Number(respScoreRaw) : null;

    const codeExplain =
      existingAnswers[`${qid}CodeFeedback`]?.response ||
      existingAnswers[`${qid}CodeExplain`]?.response ||
      '';

    const runExplain =
      existingAnswers[`${qid}RunFeedback`]?.response ||
      existingAnswers[`${qid}RunExplain`]?.response ||
      '';

    const respExplain =
      existingAnswers[`${qid}ResponseFeedback`]?.response ||
      existingAnswers[`${qid}ResponseExplain`]?.response ||
      '';

    const bucketPoints = (bucket) => {
      if (!bucket) return 0;
      if (typeof bucket === 'number') return bucket;
      if (typeof bucket === 'object' && typeof bucket.points === 'number') {
        return bucket.points;
      }
      return 0;
    };

    const scores = block?.scores || {};
    const maxCode = bucketPoints(scores.code);
    const maxRun = bucketPoints(scores.output);
    const maxResp = bucketPoints(scores.response);

    const hasAnyScore =
      codeScoreRaw != null ||
      runScoreRaw != null ||
      respScoreRaw != null ||
      Object.prototype.hasOwnProperty.call(existingAnswers, `${qid}CodeScore`) ||
      Object.prototype.hasOwnProperty.call(existingAnswers, `${qid}RunScore`) ||
      Object.prototype.hasOwnProperty.call(
        existingAnswers,
        `${qid}ResponseScore`
      );

    const earnedTotal =
      (codeScore != null ? codeScore : 0) +
      (runScore != null ? runScore : 0) +
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

  const isSubmitted = !!activity?.submitted_at;
  let globalQuestionCounter = 0;


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

         <RunActivityTestStatusBanner
          isTestMode={isTestMode}
          testWindow={testWindow}
          testLockState={testLockState}
          isStudent={isStudent}
          submittedAt={activity?.submitted_at}
          formatRemainingSeconds={formatRemainingSeconds}
        />


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
          fileContents,
          setFileContents: handleUpdateFileContents,
          onFileChange: handleFileChange,
        })}

        {groups.map((group, index) => {
          const stateKey = `${index + 1}state`;
          const rawState = existingAnswers[stateKey]?.response;
          const isComplete = normalizeStatus(rawState) === 'complete';
          const isCurrent = index === currentQuestionGroupIndex;

          // In test mode: editable only when window is open and not submitted/locked
          const testEditable =
            isTestMode &&
            isStudent &&
            !testLockState.lockedBefore &&
            !testLockState.lockedAfter &&
            !isSubmitted;

          const editable = isTestMode
            ? testEditable
            : (isActive && isCurrent && !isComplete);


          console.log('[RUN] group', index, {
            stateKey,
            rawState,
            isComplete,
            isCurrent,
            isTestMode,
            isSubmitted,
            isActive,
            editable,
          });
          // For students before start, hide groups completely
          //if (isTestMode && isStudent && testLockState.lockedBefore && !isInstructor) {
          //  return null;
          //}
          const showGroup =
            // Instructors always see everything
            isInstructor ||
            // Students in test mode:
            (isTestMode && isStudent && !testLockState.lockedBefore) ||
            // Learning mode: show completed groups and current group
            (!isTestMode && (isComplete || isCurrent));

          if (!showGroup) return null;


          // does this group currently have AI feedback/guidance?
          const hasAIGuidanceForGroup = (group.content || [])
            .filter((b) => b.type === 'question')
            .some((b) => {
              const qid = `${b.groupId}${b.id}`;
              const hasTextSuggestion = !!textFeedbackShown[qid];
              const hasFU = !!followupsShown[qid];

              // any code feedback for cells like "1acode1", "1acode2", ...
              const hasCodeFb = Object.entries(codeFeedbackShown || {}).some(
                ([key, fb]) =>
                  key.startsWith(`${qid}code`) && fb && String(fb).trim() !== ''
              );

              return hasTextSuggestion || hasFU || hasCodeFb;
            });

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

              {group.content.map((block, bIndex) => {
                // Render this block as usual
                const renderedBlock = renderBlocks([block], {
                  editable,
                  isActive,
                  mode: 'run',
                  prefill: existingAnswers,
                  currentGroupIndex: index,
                  followupsShown,
                  textFeedbackShown,
                  socket,
                  instanceId,
                  answeredBy: user?.id,
                  fileContents,
                  setFileContents: handleUpdateFileContents,
                  onFileChange: handleFileChange,
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
                    // no special FA1 handling; we store anything as text
                    setExistingAnswers((prev) => ({
                      ...prev,
                      [responseKey]: {
                        ...prev[responseKey],
                        response: value,
                        type: 'text',
                      },
                    }));
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
                });

                // If not test mode or not a question block, just return it
                if (!isTestMode || block.type !== 'question') {
                  return (
                    <div key={`group-${index}-block-${bIndex}`}>
                      {renderedBlock}
                    </div>
                  );
                }

                // Question block in test mode: attach scores panel right under it
                const qid = `${block.groupId}${block.id}`;
                globalQuestionCounter += 1;
                const scores = getQuestionScores(qid, block);

                const allowEdit =
                  isTestMode && isInstructor && isSubmitted;

                return (
                  <div
                    key={`group-${index}-block-${bIndex}`}
                    className="mb-2"
                  >
                    {renderedBlock}

                    <QuestionScorePanel
                      qid={qid}
                      displayNumber={globalQuestionCounter}
                      scores={scores}
                      allowEdit={allowEdit}
                      onSave={handleSaveQuestionScores}
                    />
                  </div>
                );
              })}


              {editable && (
                <div className="mt-2">
                  <Button onClick={() => handleSubmit(false)} disabled={isSubmitting}>
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

                  {/* Let students bypass AI gating in learning mode */}
                  {!isTestMode && hasAIGuidanceForGroup && (
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="ms-2"
                      onClick={() => {
                        setOverrideGroups((prev) => ({ ...prev, [index]: true }));
                        handleSubmit(true);
                      }}
                    >
                      Continue without fixing AI feedback
                    </Button>
                  )}
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

        {isTestMode && overallTestTotals.max > 0 && (
          <Alert variant="info" className="mt-3">
            Overall test score:{' '}
            <strong>
              {overallTestTotals.earned}/{overallTestTotals.max}
            </strong>{' '}
            (
            {(
              (overallTestTotals.earned / overallTestTotals.max) *
              100
            ).toFixed(1)}
            %)
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

      <RunActivityFloatingTimer
        isTestMode={isTestMode}
        isStudent={isStudent}
        testWindow={testWindow}
        testLockState={testLockState}
        submittedAt={activity?.submitted_at}
        formatRemainingSeconds={formatRemainingSeconds}
      />

    </>
  );
}
