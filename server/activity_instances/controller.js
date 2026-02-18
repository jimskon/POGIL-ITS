// server/activity_instances/controller.js
const db = require('../db');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { google } = require('googleapis');
const { authorize } = require('../utils/googleAuth');
const { gradeTestQuestion } = require('../ai/controller');

function escapeRegExp(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ========== DOC PARSING ==========
function parseGoogleDocHTML(html) {
  const dom = new JSDOM(html);
  const body = dom.window.document.body;
  const blocks = [];

  let currentEnv = null, envBuffer = [], currentQuestion = null;

  const formatText = (text) =>
    text.replace(/\\textit\{([^}]+)\}/g, '<em>$1</em>')
      .replace(/\\textbf\{([^}]+)\}/g, '<strong>$1</strong>');

  const finalizeEnvironment = () => {
    if (currentEnv) {
      blocks.push({ type: currentEnv, content: envBuffer.map(formatText) });
      currentEnv = null;
      envBuffer = [];
    }
  };

  const finalizeQuestion = () => {
    if (currentQuestion) {
      blocks.push({ type: 'question', ...currentQuestion });
      currentQuestion = null;
    }
  };

  for (const el of body.children) {
    const text = el.textContent.trim();
    if (!text) continue;

    const envMatch = text.match(/^\\begin\{(content|process|knowledge)\}$/);
    if (envMatch) { finalizeEnvironment(); currentEnv = envMatch[1]; continue; }
    if (currentEnv && text === `\\end{${currentEnv}}`) { finalizeEnvironment(); continue; }

    if (currentEnv) {
      envBuffer.push(text.startsWith('\\item') ? `<li>${formatText(text.replace(/^\\item\s*/, ''))}</li>` : text);
      continue;
    }

    if (/^\\(title|name|section)\{/.test(text)) {
      const type = text.match(/^\\(\w+)\{/)[1];
      const value = text.match(/\\\w+\{(.+?)\}/)?.[1];
      blocks.push({ type: 'header', field: type, content: value });
      continue;
    }

    if (text.startsWith('\\questiongroup')) {
      blocks.push({ type: 'questiongroup', title: text.match(/\\questiongroup\{(.+?)\}/)?.[1] });
      continue;
    }

    if (text.startsWith('\\question')) {
      finalizeQuestion();
      currentQuestion = { id: '', text: text.replace('\\question', '').trim(), samples: [], feedback: [], followups: [], responseLines: 1 };
      continue;
    }

    if (text.startsWith('\\textresponse')) {
      const match = text.match(/\\textresponse\{(\d+)\}/);
      if (match) currentQuestion.responseLines = parseInt(match[1]);
      continue;
    }

    if (text === '\\endquestiongroup') { finalizeQuestion(); continue; }

    if (currentQuestion) {
      currentQuestion.text += ' ' + formatText(text);
      continue;
    }

    blocks.push({ type: 'info', content: formatText(text) });
  }

  finalizeQuestion();
  finalizeEnvironment();
  return blocks;
}


// ======== Helpers for timed tests ========

function computeTestWindow(instance) {
  const { test_start_at, test_duration_minutes, test_reopen_until } = instance || {};
  if (!test_start_at || !test_duration_minutes) return null;

  const now = new Date();
  const start = new Date(test_start_at);
  const baseEnd = new Date(start.getTime() + test_duration_minutes * 60000);

  let end = baseEnd;
  if (test_reopen_until) {
    const reopenUntil = new Date(test_reopen_until);
    if (reopenUntil > end) end = reopenUntil;
  }

  return { now, start, end };
}


// ========== ROUTE CONTROLLERS ==========

// Clear all responses for an instance and reset submission/reopen info
async function clearResponsesForInstance(req, res) {
  const instanceId = Number(req.params.instanceId);
  if (!instanceId) return res.status(400).json({ error: 'Bad instance id' });

  try {
    const [del] = await db.query(
      `DELETE FROM responses WHERE activity_instance_id = ?`,
      [instanceId]
    );

    // Reset submission + reopen state so instructor can restart
    await db.query(
      `UPDATE activity_instances
   SET submitted_at      = NULL,
       graded_at         = NULL,
       review_complete   = 0,
       reviewed_at       = NULL,
       points_earned     = NULL,
       points_possible   = NULL,
       progress_status   = 'in_progress',
       test_reopen_until = NULL,
       completed_groups  = 0
   WHERE id = ?`,
      [instanceId]
    );
    global.emitInstanceState?.(instanceId, {
      submitted_at: null,
      graded_at: null,
      review_complete: 0,
      reviewed_at: null,
      points_earned: null,
      points_possible: null,
      progress_status: 'in_progress',
      test_reopen_until: null,
      completed_groups: 0, // only if you also want to reset it; if not, omit
    });


    res.json({ ok: true, cleared: del.affectedRows || 0 });
  } catch (e) {
    console.error('clearResponsesForInstance error:', e);
    res.status(500).json({ error: 'Failed to clear responses' });
  }
}


async function getParsedActivityDoc(req, res) {
  const { instanceId } = req.params;
  try {
    const [rows] = await db.query(`
      SELECT a.sheet_url
      FROM activity_instances ai
      JOIN pogil_activities a ON ai.activity_id = a.id
      WHERE ai.id = ?
    `, [instanceId]);

    if (!rows.length || !rows[0].sheet_url) {
      return res.status(404).json({ error: 'No sheet_url found' });
    }

    const docId = rows[0].sheet_url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
    if (!docId) throw new Error('Invalid sheet_url');

    const auth = authorize();
    const docs = google.docs({ version: 'v1', auth });
    const doc = await docs.documents.get({ documentId: docId });

    const lines = doc.data.body.content
      .map(block => {
        if (!block.paragraph?.elements) return null;
        return block.paragraph.elements.map(e => e.textRun?.content || '').join('').trim();
      })
      .filter(Boolean);

    res.json({ lines });
  } catch (err) {
    console.error("❌ Error parsing activity doc:", err);
    res.status(500).json({ error: 'Failed to load document' });
  }
}


async function createActivityInstance(req, res) {
  const { activityId, courseId } = req.body;
  try {
    const [result] = await db.query(
      `INSERT INTO activity_instances (activity_id, course_id) VALUES (?, ?)`,
      [activityId, courseId]
    );
    res.status(201).json({ instanceId: result.insertId });
  } catch (err) {
    console.error("❌ Failed to create activity instance:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getActivityInstanceById(req, res) {
  const { id } = req.params;

  try {
    const [[instance]] = await db.query(
      `SELECT
         ai.id,
         ai.course_id,
         ai.activity_id,
         ai.group_number,
         ai.status,
         ai.total_groups,
         ai.completed_groups,
         ai.progress_status,
         ai.test_start_at,
         ai.test_duration_minutes,
         ai.test_reopen_until,
         ai.submitted_at,
         ai.hidden,
         a.title       AS title,
         a.name        AS activity_name,
         a.sheet_url
       FROM activity_instances ai
       JOIN pogil_activities a ON ai.activity_id = a.id
       WHERE ai.id = ?`,
      [id]
    );

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    if (instance.hidden && req.user?.role === 'student') {
      return res.status(403).json({ error: 'This activity is currently hidden.' });
    }


    res.json(instance);
  } catch (err) {
    console.error('❌ Failed to fetch activity instance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}


async function getEnrolledStudents(req, res) {
  const { id } = req.params;
  try {
    const [[instance]] = await db.query(`SELECT course_id FROM activity_instances WHERE id = ?`, [id]);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });

    const [students] = await db.query(
      `SELECT u.id, u.name, u.email FROM course_enrollments ce JOIN users u ON ce.student_id = u.id
       WHERE ce.course_id = ? AND u.role = 'student'`,
      [instance.course_id]
    );
    res.json({ students });
  } catch (err) {
    console.error("❌ getEnrolledStudents:", err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
}

async function recordHeartbeat(req, res) {
  const { instanceId } = req.params;
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const ACTIVE_WINDOW_SEC = 60; // presence window

  try {
    const [[userRow]] = await db.query(`SELECT role FROM users WHERE id = ?`, [userId]);
    if (!userRow || userRow.role !== 'student') {
      return res.json({ success: true, becameActive: false });
    }

    const [[isMember]] = await db.query(
      `SELECT student_id FROM group_members
       WHERE activity_instance_id = ? AND student_id = ?`,
      [instanceId, userId]
    );
    if (!isMember) {
      return res.json({ success: true, becameActive: false });
    }

    await db.query(
      `UPDATE group_members
       SET last_heartbeat = NOW(), connected = TRUE
       WHERE activity_instance_id = ? AND student_id = ?`,
      [instanceId, userId]
    );

    const [[inst]] = await db.query(
      `SELECT active_student_id FROM activity_instances WHERE id = ?`,
      [instanceId]
    );
    if (!inst) return res.status(404).json({ error: 'Instance not found' });

    let activePresent = false;
    if (inst.active_student_id) {
      const [[row]] = await db.query(
        `SELECT (last_heartbeat IS NOT NULL AND last_heartbeat >= DATE_SUB(NOW(), INTERVAL ? SECOND)) AS present
         FROM group_members
         WHERE activity_instance_id = ? AND student_id = ?`,
        [ACTIVE_WINDOW_SEC, instanceId, inst.active_student_id]
      );
      activePresent = !!row?.present;
    }

    if (!inst.active_student_id || !activePresent) {
      const [[presentCaller]] = await db.query(
        `SELECT student_id FROM group_members
         WHERE activity_instance_id = ?
           AND student_id = ?
           AND last_heartbeat >= DATE_SUB(NOW(), INTERVAL ? SECOND)
         LIMIT 1`,
        [instanceId, userId, ACTIVE_WINDOW_SEC]
      );

      let newActiveId = presentCaller?.student_id;
      if (!newActiveId) {
        const [[anyPresent]] = await db.query(
          `SELECT student_id FROM group_members
           WHERE activity_instance_id = ?
             AND last_heartbeat >= DATE_SUB(NOW(), INTERVAL ? SECOND)
           ORDER BY last_heartbeat DESC
           LIMIT 1`,
          [instanceId, ACTIVE_WINDOW_SEC]
        );
        newActiveId = anyPresent?.student_id || null;
      }

      if (newActiveId) {
        await db.query(
          `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
          [newActiveId, instanceId]
        );
        global.emitInstanceState?.(Number(instanceId), { activeStudentId: newActiveId });
        return res.json({ success: true, becameActive: true, activeStudentId: newActiveId });
      }
    }

    return res.json({ success: true, becameActive: false, activeStudentId: inst.active_student_id });
  } catch (err) {
    console.error("❌ recordHeartbeat error:", err);
    return res.status(500).json({ error: 'Failed to record heartbeat' });
  }
}


// In getActiveStudent function in controller.js

async function getActiveStudent(req, res) {
  const { instanceId } = req.params;

  try {
    const [[instance]] = await db.query(
      `SELECT active_student_id FROM activity_instances WHERE id = ?`,
      [instanceId]
    );

    if (!instance) {
      return res.status(404).json({ error: 'Activity instance not found' });
    }

    const activeStudentId = instance.active_student_id;
    //console.log("Active student ID for instance", instanceId, "is", activeStudentId);
    res.json({ activeStudentId });
  } catch (err) {
    console.error("❌ getActiveStudent error:", err);
    res.status(500).json({ error: 'Failed to fetch active student' });
  }
}


async function rotateActiveStudent(req, res) {
  const { instanceId } = req.params;
  const { currentStudentId } = req.body;

  const [members] = await db.query(
    `SELECT student_id FROM group_members
     WHERE activity_instance_id = ? AND connected = TRUE`,
    [instanceId]
  );

  if (!currentStudentId) return res.status(400).json({ error: 'Missing currentStudentId' });

  try {
    if (!members.length) return res.status(404).json({ error: 'No connected group members' });

    const others = members.filter(m => m.student_id !== currentStudentId);
    const next = others.length ? others[Math.floor(Math.random() * others.length)] : members[0];

    await db.query(`UPDATE activity_instances SET active_student_id = ? WHERE id = ?`, [next.student_id, instanceId]);
    global.emitInstanceState?.(Number(instanceId), { activeStudentId: next.student_id });
    res.json({ activeStudentId: next.student_id });
  } catch (err) {
    console.error("❌ rotateActiveStudent:", err);
    res.status(500).json({ error: 'Failed to rotate' });
  }
}


// Body: { activityId, courseId, groups: [ { members: [ { student_id, role } ] } ], testStartAt?, testDurationMinutes? }
async function setupMultipleGroupInstances(req, res) {
  const {
    activityId,
    courseId,
    groups,
    testStartAt,
    testDurationMinutes
  } = req.body;

  if (!activityId || !courseId || !Array.isArray(groups)) {
    return res.status(400).json({ error: 'activityId, courseId, and groups are required' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Look up whether this activity is a test + sheet_url (we need sheet_url to compute total_groups)
    const [[activityRow]] = await conn.query(
      `SELECT is_test, sheet_url FROM pogil_activities WHERE id = ?`,
      [activityId]
    );

    // Treat either a DB flag *or* explicit timing info as "this is a test".
    let isTest = !!activityRow?.is_test;
    if (testStartAt && Number(testDurationMinutes) > 0) {
      isTest = true;
    }

    // Normalize incoming testStartAt (ISO) -> MySQL DATETIME string
    let testStartForDb = null;
    let effectiveDuration = 0;

    if (isTest && testStartAt && Number(testDurationMinutes) > 0) {
      const d = new Date(testStartAt);
      if (!Number.isNaN(d.getTime())) {
        testStartForDb = d.toISOString().slice(0, 19).replace('T', ' ');
        effectiveDuration = Number(testDurationMinutes);
      }
    }

    // Keep pogil_activities.is_test in sync
    await conn.query(
      `UPDATE pogil_activities SET is_test = ? WHERE id = ?`,
      [isTest ? 1 : 0, activityId]
    );

    // ✅ NEW: compute total_groups from the activity doc NOW, once
    let computedTotalGroups = 1;
    try {
      const sheetUrl = activityRow?.sheet_url || '';
      const docId = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];

      if (docId) {
        const auth = authorize();
        const docs = google.docs({ version: 'v1', auth });
        const doc = await docs.documents.get({ documentId: docId });

        const lines = (doc.data.body?.content || [])
          .map(block => {
            if (!block.paragraph?.elements) return null;
            return block.paragraph.elements
              .map(e => e.textRun?.content || '')
              .join('')
              .trim();
          })
          .filter(Boolean);

        const groupCount = lines.filter(line => line.startsWith('\\questiongroup')).length;
        computedTotalGroups = groupCount > 0 ? groupCount : 1;
      }
    } catch (e) {
      console.warn('⚠️ setupMultipleGroupInstances: failed to compute total_groups; defaulting to 1', e);
      computedTotalGroups = 1;
    }

    // Remove existing instances + members for this course+activity
    const [oldInstances] = await conn.query(
      `SELECT id FROM activity_instances WHERE course_id = ? AND activity_id = ?`,
      [courseId, activityId]
    );

    const instanceIds = oldInstances.map(r => r.id);
    if (instanceIds.length > 0) {
      await conn.query(
        `DELETE FROM group_members WHERE activity_instance_id IN (?)`,
        [instanceIds]
      );
      await conn.query(
        `DELETE FROM activity_instances WHERE id IN (?)`,
        [instanceIds]
      );
    }

    // One activity_instance per group, then insert members
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const group_number = i + 1;

      const [instanceResult] = await conn.query(
        `INSERT INTO activity_instances
           (course_id, activity_id, status, group_number, total_groups, completed_groups, progress_status, test_start_at, test_duration_minutes)
         VALUES (?, ?, 'in_progress', ?, ?, 0, 'not_started', ?, ?)`,
        [
          courseId,
          activityId,
          group_number,
          computedTotalGroups,   // ✅ critical fix
          testStartForDb,
          effectiveDuration
        ]
      );
      const instanceId = instanceResult.insertId;

      if (Array.isArray(group.members)) {
        for (const member of group.members) {
          if (!member.student_id) continue;

          const cleanRole =
            member.role &&
              ['facilitator', 'analyst', 'qc', 'spokesperson'].includes(member.role)
              ? member.role
              : null;

          await conn.query(
            `INSERT INTO group_members (activity_instance_id, student_id, role)
             VALUES (?, ?, ?)`,
            [instanceId, member.student_id, cleanRole]
          );
        }
      }
    }

    await conn.commit();
    return res.json({ success: true, total_groups: computedTotalGroups });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error setting up groups:', err);
    return res.status(500).json({ error: 'Failed to setup groups' });
  } finally {
    conn.release();
  }
}


async function submitGroupResponses(req, res) {
  const instanceId = Number(req.params.instanceId);
  const studentId = Number(req.body?.studentId);
  const answers = req.body?.answers || {};
  const groupNum = Number(req.body?.groupNum);

  if (!instanceId || !studentId || !answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Missing instanceId, studentId, or answers' });
  }
  if (!Number.isFinite(groupNum) || groupNum <= 0) {
    return res.status(400).json({ error: 'Missing/invalid groupNum' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ---- 1) Upsert all submitted answer fields as-is ----
    // (These include: 2a, 2aF1, 2aFA1, etc.)
    for (const [qidRaw, valueRaw] of Object.entries(answers)) {
      const qid = String(qidRaw || '').trim();
      if (!qid) continue;

      const value = valueRaw == null ? '' : String(valueRaw);

      await conn.query(
        `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
         VALUES (?, ?, 'text', ?, ?)
         ON DUPLICATE KEY UPDATE response = VALUES(response), updated_at = CURRENT_TIMESTAMP`,
        [instanceId, qid, value, studentId]
      );
    }

    // ---- 2) Write per-question completion markers (2aS = completed/inprogress) ----
    // We compute this only for the base questions present in this submit payload.
    // Base = 2a from 2aFA1, 2aF1, etc.
    const baseIds = new Set();
    for (const key of Object.keys(answers)) {
      const m = String(key).match(/^([0-9]+[a-zA-Z])/);
      if (m) baseIds.add(m[1]);
    }

    for (const base of baseIds) {
      const main = String(answers[base] ?? '').trim();
      let hasMain = main.length > 0;

      // If followup prompts exist (baseF1, baseF2...), ensure their answers exist (baseFA1, ...)
      let allFollowupsAnswered = true;

      // Look for prompts baseF#
      for (const k of Object.keys(answers)) {
        const fm = String(k).match(new RegExp(`^${base}F(\\d+)$`));
        if (!fm) continue;

        const n = fm[1];
        const ansKey = `${base}FA${n}`;
        const ansVal = String(answers[ansKey] ?? '').trim();
        if (!ansVal) allFollowupsAnswered = false;
      }

      const qComplete = hasMain && allFollowupsAnswered;
      const qState = qComplete ? 'complete' : 'inprogress';

      await conn.query(
        `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
         VALUES (?, ?, 'text', ?, ?)
         ON DUPLICATE KEY UPDATE response = VALUES(response), updated_at = CURRENT_TIMESTAMP`,
        [instanceId, `${base}S`, qState, studentId]
      );
    }

    // ---- 3) Mark the submitted GROUP as completed (this is the critical fix) ----
    await conn.query(
      `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
       VALUES (?, ?, 'text', 'complete', ?)
       ON DUPLICATE KEY UPDATE response = 'complete', updated_at = CURRENT_TIMESTAMP`,
      [instanceId, `${groupNum}state`, studentId]
    );

    // ---- 4) Recompute cached progress from i=1..total_groups using istate ----
    const [[meta]] = await conn.query(
      `SELECT total_groups FROM activity_instances WHERE id = ?`,
      [instanceId]
    );
    const totalGroups = Number(meta?.total_groups) || 0;

    let completedGroups = 0;
    if (totalGroups > 0) {
      const [stateRows] = await conn.query(
        `SELECT question_id, response
         FROM responses
         WHERE activity_instance_id = ?
           AND question_id REGEXP '^[0-9]+state$'`,
        [instanceId]
      );

      const stateMap = new Map(
        stateRows.map(r => [String(r.question_id), String(r.response || '').toLowerCase()])
      );

      for (let i = 1; i <= totalGroups; i++) {
        if (stateMap.get(`${i}state`) === 'complete') completedGroups++;
        else break; // sequential contract
      }
    }

    const progressStatus =
      totalGroups > 0 && completedGroups >= totalGroups ? 'completed' : 'in_progress';

    await conn.query(
      `UPDATE activity_instances
       SET completed_groups = ?, progress_status = ?
       WHERE id = ?`,
      [completedGroups, progressStatus, instanceId]
    );

    emitPatch = { completed_groups: completedGroups, progress_status: progressStatus };


    // ---- 5) Rotate active student among connected members ----
    const [connected] = await conn.query(
      `SELECT student_id
       FROM group_members
       WHERE activity_instance_id = ? AND connected = TRUE`,
      [instanceId]
    );

    if (connected.length > 0) {
      const eligible = connected.filter(m => Number(m.student_id) !== studentId);
      const pickFrom = eligible.length ? eligible : connected;
      const next = pickFrom[Math.floor(Math.random() * pickFrom.length)].student_id;

      await conn.query(
        `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
        [next, instanceId]
      );

      emitPatch = { ...(emitPatch || {}), activeStudentId: next };
    }

    await conn.commit();

    if (emitPatch) global.emitInstanceState?.(instanceId, emitPatch);

    return res.json({
      success: true, completed_groups: completedGroups, progress_status: progressStatus,
      ...(emitPatch?.activeStudentId ? { activeStudentId: emitPatch.activeStudentId } : {}),

    });
  } catch (err) {
    await conn.rollback();
    console.error('❌ submitGroupResponses:', err);
    return res.status(500).json({ error: 'Failed to save responses' });
  } finally {
    conn.release();
  }
}




async function getInstanceGroups(req, res) {
  const { instanceId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT gm.student_id, gm.role, u.name AS student_name, u.email AS student_email
       FROM group_members gm
       JOIN users u ON gm.student_id = u.id
       WHERE gm.activity_instance_id = ?
       ORDER BY gm.role`,
      [instanceId]
    );

    const roleLabels = { qc: 'Quality Control' };

    res.json({
      groups: [{
        group_id: instanceId,
        group_number: 1,
        members: rows.map(r => ({
          student_id: r.student_id,
          name: r.student_name,
          email: r.student_email,
          role: roleLabels[r.role] || r.role
        }))
      }]
    });
  } catch (err) {
    console.error("❌ getInstanceGroups:", err);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
}

async function getInstancesForActivityInCourse(req, res) {
  const { courseId, activityId } = req.params;
  try {
    const [[course]] = await db.query(`SELECT name FROM courses WHERE id = ?`, [courseId]);
    const [[activity]] = await db.query(`SELECT title FROM pogil_activities WHERE id = ?`, [activityId]);

    const courseName = course?.name || 'Unknown Course';
    const activityTitle = activity?.title || '';

    const [instances] = await db.query(
      `SELECT id AS instance_id,
              group_number,
              active_student_id,
              total_groups,
              completed_groups,
              progress_status,
              test_start_at,
              test_duration_minutes,
              test_reopen_until,
              submitted_at,
              graded_at,
              review_complete,
              reviewed_at,
              points_earned,
              points_possible
       FROM activity_instances
       WHERE course_id = ? AND activity_id = ?
       ORDER BY group_number`,
      [courseId, activityId]
    );


    const groups = [];
    for (const inst of instances) {
      const [members] = await db.query(
        `SELECT gm.student_id, gm.role, u.name AS student_name, u.email AS student_email, gm.connected
         FROM group_members gm
         JOIN users u ON gm.student_id = u.id
         WHERE gm.activity_instance_id = ?
         ORDER BY gm.role`,
        [inst.instance_id]
      );
      const memberIds = new Set(members.map(m => m.student_id));
      let activeId = inst.active_student_id;

      if (!activeId || !memberIds.has(activeId)) {
        const connectedMember = members.find(m => !!m.connected);
        const fallback = connectedMember?.student_id ?? members[0]?.student_id ?? null;

        if (fallback !== null && fallback !== activeId) {
          await db.query(
            `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
            [fallback, inst.instance_id]
          );
          activeId = fallback;
          global.emitInstanceState?.(inst.instance_id, { activeStudentId: activeId });

        }
      }

      const roleLabels = { qc: 'Quality Control' };
      groups.push({
        instance_id: inst.instance_id,
        group_number: inst.group_number,
        active_student_id: activeId,

        // ✅ THE DB TRUTH FIELDS YOUR UI WANTS
        total_groups: inst.total_groups,
        completed_groups: inst.completed_groups,
        progress_status: inst.progress_status,

        // Optional convenience label for UI (derived *from* DB truth)
        // progress: progress,  // you can keep or delete this

        test_start_at: inst.test_start_at,
        test_duration_minutes: inst.test_duration_minutes,
        test_reopen_until: inst.test_reopen_until,
        submitted_at: inst.submitted_at,
        graded_at: inst.graded_at,
        review_complete: inst.review_complete,
        reviewed_at: inst.reviewed_at,
        points_earned: inst.points_earned,
        points_possible: inst.points_possible,
        members: members.map(m => ({
          student_id: m.student_id,
          name: m.student_name,
          email: m.student_email,
          role: roleLabels[m.role] || m.role,
          connected: !!m.connected
        }))
      });
    }

    res.json({ courseName, activityTitle, groups });
  } catch (err) {
    console.error("❌ getInstancesForActivityInCourse:", err);
    res.status(500).json({ error: 'Failed to fetch instances' });
  }
}

// NEW route: GET /api/responses/:instanceId
async function getInstanceResponses(req, res) {
  const { instanceId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT question_id, response, response_type
       FROM responses
       WHERE activity_instance_id = ?`,
      [instanceId]
    );

    const responses = {};
    for (const row of rows) {
      responses[row.question_id] = {
        response: row.response,
        type: row.response_type
      };
    }

    res.json(responses);
  } catch (err) {
    console.error("❌ getInstanceResponses error:", err);
    res.status(500).json({ error: 'Failed to fetch responses' });
  }
}

async function refreshTotalGroups(req, res) {
  const { instanceId } = req.params;

  try {
    // 1) Look up the activity + sheet_url for this instance
    const [[row]] = await db.query(
      `SELECT ai.activity_id, a.sheet_url
       FROM activity_instances ai
       JOIN pogil_activities a ON ai.activity_id = a.id
       WHERE ai.id = ?`,
      [instanceId]
    );

    if (!row) {
      return res.status(404).json({ error: 'Activity instance not found' });
    }

    if (!row.sheet_url) {
      await db.query(
        `UPDATE activity_instances SET total_groups = 1 WHERE id = ?`,
        [instanceId]
      );
      return res.json({ success: true, groupCount: 1, isTest: false });
    }

    const docId = row.sheet_url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
    if (!docId) {
      throw new Error(`Invalid sheet_url for instance ${instanceId}: ${row.sheet_url}`);
    }

    const auth = authorize();
    const docs = google.docs({ version: 'v1', auth });
    const doc = await docs.documents.get({ documentId: docId });

    const lines = (doc.data.body?.content || [])
      .map(block => {
        if (!block.paragraph?.elements) return null;
        return block.paragraph.elements
          .map(e => e.textRun?.content || '')
          .join('')
          .trim();
      })
      .filter(Boolean);

    let groupCount = lines.filter(line => line.startsWith('\\questiongroup')).length;
    if (groupCount <= 0) groupCount = 1;

    const isTest = lines.some(line => line.trim() === '\\test');

    await db.query(
      `UPDATE activity_instances
       SET total_groups = ?
       WHERE id = ?`,
      [groupCount, instanceId]
    );

    // NEW: update pogil_activities.is_test based on \test tag
    await db.query(
      `UPDATE pogil_activities
       SET is_test = ?
       WHERE id = ?`,
      [isTest ? 1 : 0, row.activity_id]
    );

    return res.json({ success: true, groupCount, isTest });
  } catch (err) {
    console.error('❌ refreshTotalGroups:', err);
    return res.status(500).json({ error: 'Failed to refresh total_groups' });
  }
}

// POST /api/activity-instances/:instanceId/test-settings
// Body: { testStartAt, testDurationMinutes }
async function updateTestSettings(req, res) {
  const { instanceId } = req.params;
  const { testStartAt, testDurationMinutes } = req.body || {};

  if (!instanceId) return res.status(400).json({ error: 'Missing instanceId' });

  const minutes = Number(testDurationMinutes);
  if (!testStartAt || !Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ error: 'testStartAt and positive testDurationMinutes required' });
  }

  const d = new Date(testStartAt);
  if (Number.isNaN(d.getTime())) {
    return res.status(400).json({ error: 'Invalid testStartAt' });
  }

  // Store as UTC datetime string for MySQL
  const startForDb = d.toISOString().slice(0, 19).replace('T', ' ');

  try {
    // Optional: wipe reopen window when you change the base window
    await db.query(
      `UPDATE activity_instances
       SET test_start_at = ?,
           test_duration_minutes = ?,
           test_reopen_until = NULL
       WHERE id = ?`,
      [startForDb, minutes, instanceId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ updateTestSettings error:', err);
    return res.status(500).json({ error: 'Failed to update test settings' });
  }
}

// NEW: Reopen a timed test for an instance
async function reopenInstance(req, res) {
  const { instanceId } = req.params;   // ✅ correct param
  const { minutes } = req.body || {};  // optional override

  if (!instanceId) {
    return res.status(400).json({ error: 'Missing instanceId' });
  }

  try {
    const [[instance]] = await db.query(
      `SELECT test_start_at, test_duration_minutes, test_reopen_until, submitted_at
       FROM activity_instances
       WHERE id = ?`,
      [instanceId]
    );

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    if (!instance.test_start_at || !instance.test_duration_minutes) {
      return res.status(400).json({ error: 'Not a timed test instance' });
    }

    // If you want to block reopen when already submitted, enforce here
    if (instance.submitted_at) {
      return res.status(400).json({ error: 'Test already submitted; clear answers to reopen.' });
    }

    const extendMinutes =
      minutes && minutes > 0 ? minutes : instance.test_duration_minutes;

    const now = new Date();
    const reopenUntil = new Date(now.getTime() + extendMinutes * 60000);

    await db.query(
      `UPDATE activity_instances
       SET test_reopen_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
       WHERE id = ?`,
      [extendMinutes, instanceId]
    );

    return res.json({ ok: true, test_reopen_until: reopenUntil });
  } catch (err) {
    console.error('❌ reopenInstance error:', err);
    return res.status(500).json({ error: 'Failed to reopen test.' });
  }
}

// Helper: parse score specs from either style:
//   \score{10,code} or \score{6,response}
//   \score{code=4,output=2,response=4}
function parseScoreSpec(specRaw) {
  const spec = String(specRaw || '').trim();
  const out = {};

  // style A: "code=4,output=2,response=4"
  if (spec.includes('=')) {
    for (const part of spec.split(/[;,]/)) {
      const [kRaw, vRaw] = part.split('=');
      if (!kRaw || !vRaw) continue;
      const k = kRaw.trim().toLowerCase();
      const v = Number(String(vRaw).trim());
      if (!Number.isFinite(v)) continue;

      if (k === 'code' || k === 'codes') out.code = v;
      else if (k === 'output' || k === 'run') out.output = v;
      else if (k === 'response') out.response = v;
    }
    return out;
  }

  // style B: "10,code" (or "6,response")
  // allow whitespace: "10, code"
  const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const pts = Number(parts[0]);
    const bucket = parts[1].toLowerCase();

    if (Number.isFinite(pts)) {
      if (bucket === 'code') out.code = pts;
      else if (bucket === 'output' || bucket === 'run') out.output = pts;
      else if (bucket === 'response') out.response = pts;
    }
  }

  return out;
}

// Helper: flatten Google doc into trimmed lines (same as you already do)
async function loadTestQuestionsForInstance(instanceId) {
  const [[row]] = await db.query(
    `SELECT ai.activity_id, a.sheet_url
     FROM activity_instances ai
     JOIN pogil_activities a ON ai.activity_id = a.id
     WHERE ai.id = ?`,
    [instanceId]
  );

  if (!row) throw new Error(`Activity instance ${instanceId} not found`);
  if (!row.sheet_url) throw new Error(`No sheet_url for activity_id ${row.activity_id}`);

  const docId = row.sheet_url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!docId) throw new Error(`Invalid sheet_url: ${row.sheet_url}`);

  const auth = authorize();
  const docs = google.docs({ version: 'v1', auth });
  const doc = await docs.documents.get({ documentId: docId });

  const lines = (doc.data.body?.content || [])
    .map(block => {
      if (!block.paragraph?.elements) return null;
      return block.paragraph.elements.map(e => e.textRun?.content || '').join('').trim();
    })
    .filter(Boolean);

  const questions = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    let qIndex = 0;
    // New question
    // New question (must be \question{...})
    if (/^\\question\{/.test(line)) {
      if (current) questions.push(current);

      const m = line.match(/^\\question\{([\s\S]*?)\}\s*$/);
      const qText = m ? m[1].trim() : ''; // if multi-paragraph, you'll append later
      current = { id: null, text: qText, scores: {} };
      continue;
    }

    // Skip question groups entirely
    if (/^\\questiongroup\{/.test(line)) {
      continue;
    }


    // Score tag
    if (line.startsWith('\\score') && current) {
      const m = line.match(/^\\score\{([^}]*)\}/);
      console.log('SCORE LINE for Q', qIndex, 'RAW=', line, 'PARSED=', m?.[1]);

      if (m) {
        current.scores = parseScoreSpec(m[1]);
      }
      continue;
    }

    // Accumulate extra lines into question text (optional)
    if (current) {
      // Stop at end markers if you want; but keeping it simple:
      if (!line.startsWith('\\end')) {
        current.text = current.text ? (current.text + ' ' + line) : line;
      }
      continue;
    }
  }

  if (current) questions.push(current);
  return questions;
}

async function getBaseQidsFirstSeen(conn, instanceId) {
  const [all] = await conn.query(
    `SELECT id, question_id
     FROM responses
     WHERE activity_instance_id = ?
     ORDER BY id ASC`,
    [instanceId]
  );

  const isBaseCandidate = (qidRaw) => {
    const qid = String(qidRaw || '').trim();
    if (!qid) return false;

    // global keys
    if (qid === 'testTotalScore' || qid === 'testMaxScore' || qid === 'testSummary') return false;

    // artifacts written by submit/regrade
    if (/CodeScore$/i.test(qid)) return false;
    if (/RunScore$/i.test(qid)) return false;
    if (/ResponseScore$/i.test(qid)) return false;
    if (/CodeFeedback$/i.test(qid)) return false;
    if (/RunFeedback$/i.test(qid)) return false;
    if (/ResponseFeedback$/i.test(qid)) return false;
    if (/Output$/i.test(qid)) return false;

    // code cell answers: 1code1, 2acode2, etc.
    if (/code\d+$/i.test(qid)) return false;

    // per-question / per-group state markers (your collaborative flow)
    if (/^\d+state$/i.test(qid)) return false;
    if (/^[0-9]+[a-zA-Z]S$/i.test(qid)) return false;

    return true;
  };

  const firstSeen = new Map();
  for (const r of all) {
    const qid = String(r.question_id || '').trim();
    if (!isBaseCandidate(qid)) continue;
    if (!firstSeen.has(qid)) firstSeen.set(qid, r.id);
  }

  return [...firstSeen.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([qid]) => qid);
}


async function regradeTestInstance(req, res) {
  const { instanceId } = req.params;
  if (!instanceId) return res.status(400).json({ error: 'Missing instanceId' });

  let questions;
  try {
    questions = await loadTestQuestionsForInstance(instanceId);
  } catch (err) {
    console.error('❌ regradeTestInstance: failed to load questions:', err);
    return res.status(500).json({ error: 'Failed to load test questions for regrade' });
  }

  console.log('🔁 regradeTestInstance for', instanceId, 'questions:', questions.length);

  let conn = null;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // Pick any student in this instance as the "answer owner"
    const [[memberRow]] = await conn.query(
      `SELECT student_id
       FROM group_members
       WHERE activity_instance_id = ?
       ORDER BY id
       LIMIT 1`,
      [instanceId]
    );
    const defaultAnswererId = memberRow?.student_id || 0;

    // Load all stored responses for this instance
    const [rows] = await conn.query(
      `SELECT question_id, response
       FROM responses
       WHERE activity_instance_id = ?`,
      [instanceId]
    );

    const answers = {};
    for (const row of rows) {
      answers[row.question_id] = row.response ?? '';
    }

    // Map parsed question order -> base qids found in DB
    const baseIds = await getBaseQidsFirstSeen(conn, instanceId);
    console.log('🧭 [regrade] baseIds from DB (first-seen):', baseIds.slice(0, 60));

    for (let i = 0; i < questions.length; i++) {
      if (baseIds[i]) questions[i].id = baseIds[i];
    }

    const upsertResponse = async (qid, value, type = 'text') => {
      if (value == null) return;
      const s = String(value);
      if (!s.trim()) return;

      await conn.query(
        `
        INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          response      = VALUES(response),
          response_type = VALUES(response_type),
          answered_by_user_id = VALUES(answered_by_user_id),
          updated_at    = CURRENT_TIMESTAMP
        `,
        [instanceId, qid, type, s, defaultAnswererId]
      );
    };

    const bucketPoints = (bucket) => {
      if (!bucket) return 0;
      if (typeof bucket === 'number') return bucket;
      if (typeof bucket === 'object' && typeof bucket.points === 'number') return bucket.points;
      return 0;
    };

    let totalEarnedPoints = 0;
    let totalMaxPoints = 0;
    const questionResults = [];

    for (const q of questions) {
      const baseId = q.id || q.qid;
      if (!baseId) continue;

      const text = q.text || '';
      const scores = q.scores || {};

      const maxCodePts = bucketPoints(scores.code);
      const maxRunPts = bucketPoints(scores.output);
      const maxRespPts = bucketPoints(scores.response);

      if (maxCodePts <= 0 && maxRunPts <= 0 && maxRespPts <= 0) {
        console.log('⚠️ [regrade] No points configured for question', baseId, '- skipping grading.');
        continue;
      }

      const written = (answers[baseId] || '').trim();

      // code cells from stored answers
      const codeCells = [];
      const rxOld = new RegExp(`^${escapeRegExp(baseId)}code(\\d+)$`, 'i');
      const rxNew = new RegExp(`^${escapeRegExp(baseId)}-code-(\\d+)$`, 'i');

      for (const [key, value] of Object.entries(answers)) {
        if (!value || !String(value).trim()) continue;

        let m = key.match(rxOld);
        if (!m) m = key.match(rxNew);
        if (!m) continue;

        const n = m[1];
        codeCells.push({
          qid: key,
          code: String(value),
          lang: 'cpp',
          label: `code ${n}`,
        });
      }


      // output saved by submitTest as `${baseId}Output`
      let outputText = String(answers[`${baseId}Output`] || '').trim();

      // Back-compat fallbacks (only if you used other key styles at some point)
      if (!outputText) {
        const rxOut1 = new RegExp(`^${escapeRegExp(baseId)}output$`, 'i');
        const rxOut2 = new RegExp(`^${escapeRegExp(baseId)}-output$`, 'i');

        for (const [k, v] of Object.entries(answers)) {
          if (rxOut1.test(k) || rxOut2.test(k)) {
            outputText = String(v || '').trim();
            break;
          }
        }
      }


      console.log('🧪 [regrade] artifacts for', baseId, {
        writtenPresent: !!written,
        codeCellsCount: codeCells.length,
        hasOutput: !!outputText,
      });

      const {
        codeScore, codeFeedback,
        runScore, runFeedback,
        responseScore, responseFeedback,
      } = await gradeTestQuestion({
        questionText: text,
        scores,
        responseText: written,
        codeCells,
        outputText,
        rubric: scores,
      });

      const earned = (codeScore || 0) + (runScore || 0) + (responseScore || 0);
      const maxPts = maxCodePts + maxRunPts + maxRespPts;

      totalEarnedPoints += earned;
      totalMaxPoints += maxPts;

      questionResults.push({
        qid: baseId,
        maxCodePts, maxRunPts, maxRespPts,
        codeScore, runScore, responseScore,
        codeFeedback: codeFeedback || '',
        runFeedback: runFeedback || '',
        responseFeedback: responseFeedback || '',
      });

      await upsertResponse(`${baseId}CodeScore`, codeScore, 'text');
      await upsertResponse(`${baseId}CodeFeedback`, codeFeedback, 'text');
      await upsertResponse(`${baseId}RunScore`, runScore, 'text');
      await upsertResponse(`${baseId}RunFeedback`, runFeedback, 'text');
      await upsertResponse(`${baseId}ResponseScore`, responseScore, 'text');
      await upsertResponse(`${baseId}ResponseFeedback`, responseFeedback, 'text');
    }

    const summaryText =
      questionResults
        .map(qr => `Question ${qr.qid} – Total ${(qr.codeScore || 0) + (qr.runScore || 0) + (qr.responseScore || 0)}/${qr.maxCodePts + qr.maxRunPts + qr.maxRespPts}`)
        .join('\n') +
      `\n\nOverall: ${totalEarnedPoints}/${totalMaxPoints}`;

    await upsertResponse('testTotalScore', totalEarnedPoints, 'text');
    await upsertResponse('testMaxScore', totalMaxPoints, 'text');
    await upsertResponse('testSummary', summaryText, 'text');

    await conn.query(
      `UPDATE activity_instances
       SET points_earned = ?, points_possible = ?, graded_at = UTC_TIMESTAMP(),
           review_complete = 0, reviewed_at = NULL
       WHERE id = ?`,
      [totalEarnedPoints, totalMaxPoints, instanceId]
    );
    global.emitInstanceState?.(Number(instanceId), {
      points_earned: totalEarnedPoints,
      points_possible: totalMaxPoints,
      review_complete: 0,
      reviewed_at: null,
      // graded_at is DB-time; optional select to send exact
    });

    await conn.commit();
    return res.json({ ok: true, regraded: true, earned: totalEarnedPoints, max: totalMaxPoints });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('❌ regradeTestInstance failed:', err);
    return res.status(500).json({ error: 'regrade-test failed' });
  } finally {
    if (conn) conn.release();
  }
}


async function submitTest(req, res) {
  const { instanceId } = req.params;
  const { studentId, answers, questions = [] } = req.body || {};

  if (!instanceId || !studentId || !answers) {
    return res
      .status(400)
      .json({ error: 'Missing instanceId, studentId, or answers' });
  }

  console.log('🧪 submitTest instance:', instanceId, 'student:', studentId);
  console.log('🧪 submitTest answers keys:', Object.keys(answers));
  console.log('🧪 submitTest question list:', questions.length);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let totalEarnedPoints = 0;
    let totalMaxPoints = 0;
    const questionResults = [];

    const upsertResponse = async (qid, value, type = 'text') => {
      if (value == null || String(value).trim() === '') return;
      await conn.query(
        `
        INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          response = VALUES(response),
          response_type = VALUES(response_type),
          answered_by_user_id = VALUES(answered_by_user_id),
          updated_at = CURRENT_TIMESTAMP
        `,
        [instanceId, qid, type, String(value), studentId]
      );
    };

    for (const q of questions) {
      const baseId = q.id || q.qid;
      if (!baseId) {
        console.error('❌ submitTest: question missing id:', q);
        continue;
      }

      const text = q.text || '';
      const scores = q.scores || {};

      const bucketPoints = (bucket) => {
        if (!bucket) return 0;
        if (typeof bucket === 'number') return bucket;
        if (typeof bucket === 'object' && typeof bucket.points === 'number') {
          return bucket.points;
        }
        return 0;
      };

      const maxCodePts = bucketPoints(scores.code);
      const maxRunPts = bucketPoints(scores.output);
      const maxRespPts = bucketPoints(scores.response);

      console.log('🧮 Question rubric:', {
        qid: baseId,
        scores,
        maxCodePts,
        maxRunPts,
        maxRespPts,
      });

      const written = (answers[baseId] || '').trim();
      const codeCells = [];
      const rxOld = new RegExp(`^${escapeRegExp(baseId)}code(\\d+)$`, 'i');
      const rxNew = new RegExp(`^${escapeRegExp(baseId)}-code-(\\d+)$`, 'i');

      for (const [key, value] of Object.entries(answers)) {
        if (!value || !String(value).trim()) continue;

        let m = key.match(rxOld);
        if (!m) m = key.match(rxNew);
        if (!m) continue;

        const n = m[1];
        codeCells.push({
          qid: key,
          code: String(value),
          lang: 'cpp',
          label: `code ${n}`,
        });
      }

      let outputText = '';
      const outputPrefix = (baseId + 'output').toLowerCase();

      for (const [key, value] of Object.entries(answers)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === outputPrefix || lowerKey.startsWith(outputPrefix)) {
          outputText = String(value || '').trim();
          break;
        }
      }

      // 🔹 Persist the raw student artifacts for this question

      // 1) Written answer (main text)
      if (written) {
        await upsertResponse(baseId, written, 'text');
      }

      // 2) Code cells
      for (const cell of codeCells) {
        await upsertResponse(cell.qid, cell.code, 'code');  // e.g., "1code1"
      }

      // 3) Run output that grading used
      if (outputText) {
        await upsertResponse(`${baseId}Output`, outputText, 'run_output');
      }

      console.log('🧪 submitTest artifacts for', baseId, {
        writtenPresent: !!written,
        codeCellsCount: codeCells.length,
        hasOutput: !!outputText,
      });

      if (maxCodePts <= 0 && maxRunPts <= 0 && maxRespPts <= 0) {
        console.log(
          '⚠️ No points configured for question',
          baseId,
          '- skipping grading.'
        );
        continue;
      }

      const {
        codeScore,
        codeFeedback,
        runScore,
        runFeedback,
        responseScore,
        responseFeedback,
      } = await gradeTestQuestion({
        questionText: text,
        scores,
        responseText: written,
        codeCells,
        outputText,
        rubric: scores,
      });

      console.log('✅ Test grading result:', {
        instanceId,
        studentId,
        qid: baseId,
        maxCodePts,
        maxRunPts,
        maxRespPts,
        codeScore,
        runScore,
        responseScore,
      });

      const earned =
        (codeScore || 0) +
        (runScore || 0) +
        (responseScore || 0);

      const maxPts = maxCodePts + maxRunPts + maxRespPts;

      totalEarnedPoints += earned;
      totalMaxPoints += maxPts;

      questionResults.push({
        qid: baseId,
        maxCodePts,
        maxRunPts,
        maxRespPts,
        codeScore,
        runScore,
        responseScore,
        codeFeedback: codeFeedback || '',
        runFeedback: runFeedback || '',
        responseFeedback: responseFeedback || '',
      });

      const upsert = async (qid, value) => {
        if (value == null || value === '') return;
        await conn.query(
          `
          INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
          VALUES (?, ?, 'text', ?, ?)
          ON DUPLICATE KEY UPDATE
            response = VALUES(response),
            answered_by_user_id = VALUES(answered_by_user_id),
            updated_at = CURRENT_TIMESTAMP
        `,
          [instanceId, qid, String(value), studentId]
        );
      };

      await upsert(`${baseId}CodeScore`, codeScore);
      await upsert(`${baseId}CodeFeedback`, codeFeedback);

      await upsert(`${baseId}RunScore`, runScore);
      await upsert(`${baseId}RunFeedback`, runFeedback);

      await upsert(`${baseId}ResponseScore`, responseScore);
      await upsert(`${baseId}ResponseFeedback`, responseFeedback);
    }

    const lines = [];

    for (const qr of questionResults) {
      const {
        qid,
        maxCodePts = 0,
        maxRunPts = 0,
        maxRespPts = 0,
        codeScore = 0,
        runScore = 0,
        responseScore = 0,
        codeFeedback = '',
        runFeedback = '',
        responseFeedback = '',
      } = qr;

      const bandParts = [];
      if (maxCodePts > 0) bandParts.push(`Code ${codeScore}/${maxCodePts}`);
      if (maxRunPts > 0) bandParts.push(`Run ${runScore}/${maxRunPts}`);
      if (maxRespPts > 0) bandParts.push(`Response ${responseScore}/${maxRespPts}`);

      const qMax = maxCodePts + maxRunPts + maxRespPts;
      const qScore = codeScore + runScore + responseScore;

      lines.push(`Question ${qid} – Total ${qScore}/${qMax}`);
      if (bandParts.length) {
        lines.push(`  ${bandParts.join(' · ')}`);
      }

      if (maxCodePts > 0 && codeScore < maxCodePts && codeFeedback) {
        lines.push(`  Code feedback: ${codeFeedback}`);
      }
      if (maxRunPts > 0 && runScore < maxRunPts && runFeedback) {
        lines.push(`  Run feedback: ${runFeedback}`);
      }
      if (maxRespPts > 0 && responseScore < maxRespPts && responseFeedback) {
        lines.push(`  Response feedback: ${responseFeedback}`);
      }

      lines.push('');
    }

    lines.push(`Overall: ${totalEarnedPoints}/${totalMaxPoints}`);

    const summaryText = lines.join('\n');

    console.log('📊 Test grading summary:', {
      instanceId,
      studentId,
      totalEarnedPoints,
      totalMaxPoints,
    });

    const upsertTotal = async (qid, value) => {
      if (value == null) return;
      await conn.query(
        `
        INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
        VALUES (?, ?, 'text', ?, ?)
        ON DUPLICATE KEY UPDATE
          response = VALUES(response),
          answered_by_user_id = VALUES(answered_by_user_id),
          updated_at = CURRENT_TIMESTAMP
      `,
        [instanceId, qid, String(value), studentId]
      );
    };

    await upsertTotal('testTotalScore', totalEarnedPoints);
    await upsertTotal('testMaxScore', totalMaxPoints);
    await upsertTotal('testSummary', summaryText);

    await conn.query(
      `UPDATE activity_instances
   SET
     points_earned    = ?,
     points_possible  = ?,
     progress_status  = 'completed',
     submitted_at     = COALESCE(submitted_at, UTC_TIMESTAMP()),
     graded_at        = UTC_TIMESTAMP()
   WHERE id = ?`,
      [totalEarnedPoints, totalMaxPoints, instanceId]
    );

    global.emitInstanceState?.(Number(instanceId), {
      points_earned: totalEarnedPoints,
      points_possible: totalMaxPoints,
      progress_status: 'completed',
      // no is_test here
    });



    await conn.commit();
    return res.json({
      ok: true,
      earned: totalEarnedPoints,
      max: totalMaxPoints,
      questions: questionResults,
      summary: summaryText,
    });
  } catch (err) {
    await conn.rollback();
    console.error('❌ submitTest failed:', err);
    return res.status(500).json({ error: 'submit-test failed' });
  } finally {
    conn.release();
  }
}

// Mark a graded test instance as reviewed by an instructor
async function markInstanceReviewed(req, res) {
  const { instanceId } = req.params;

  try {
    await db.query(
      `UPDATE activity_instances
       SET review_complete = 1,
           reviewed_at     = UTC_TIMESTAMP()
       WHERE id = ?`,
      [instanceId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ markInstanceReviewed error:', err);
    res.status(500).json({ error: 'Failed to mark reviewed' });
  }
}


// NEW lightweight endpoint
async function markTestSubmitted(req, res) {
  const { instanceId } = req.params;
  const { totalEarnedPoints, totalMaxPoints } = req.body || {};

  if (!instanceId) {
    return res.status(400).json({ error: 'Missing instanceId' });
  }

  try {
    await db.query(
      `UPDATE activity_instances
   SET
     points_earned   = ?,
     points_possible = ?,
     progress_status = 'completed',
     submitted_at    = UTC_TIMESTAMP(),
     graded_at       = UTC_TIMESTAMP()
   WHERE id = ?`,
      [totalEarnedPoints ?? 0, totalMaxPoints ?? 0, instanceId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ markTestSubmitted failed:', err);
    return res.status(500).json({ error: 'mark-test-submitted failed' });
  }
}

// PUT /api/courses/:courseId/activities/:activityId/hidden
// Body: { hidden: true/false }
async function setActivityHiddenForCourse(req, res) {
  const { courseId, activityId } = req.params;
  const hidden = req.body?.hidden ? 1 : 0;

  if (!courseId || !activityId) {
    return res.status(400).json({ error: 'Missing courseId or activityId' });
  }

  try {
    // Optional: enforce instructor-like auth here if your routes don't already
    // if (!['instructor','root','creator'].includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });

    const [result] = await db.query(
      `UPDATE activity_instances
       SET hidden = ?
       WHERE course_id = ? AND activity_id = ?`,
      [hidden, courseId, activityId]
    );

    return res.json({ ok: true, hidden: !!hidden, affected: result.affectedRows || 0 });
  } catch (err) {
    console.error('❌ setActivityHiddenForCourse:', err);
    return res.status(500).json({ error: 'Failed to update hidden flag' });
  }
}


// Export it as part of the module
module.exports = {
  clearResponsesForInstance,
  getParsedActivityDoc,
  createActivityInstance,
  getActivityInstanceById,
  getEnrolledStudents,
  recordHeartbeat,
  getActiveStudent,
  rotateActiveStudent,
  setupMultipleGroupInstances,
  submitGroupResponses,
  getInstanceGroups,
  getInstancesForActivityInCourse,
  getInstanceResponses,
  refreshTotalGroups,
  reopenInstance,
  submitTest,
  markInstanceReviewed,
  regradeTestInstance,
  markTestSubmitted,
  updateTestSettings,
  setActivityHiddenForCourse,
};
