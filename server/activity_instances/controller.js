// server/activity_instances/controller.js
const db = require('../db');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { google } = require('googleapis');
const { authorize } = require('../utils/googleAuth');
const { gradeTestQuestion } = require('../ai/controller');


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
       SET submitted_at     = NULL,
           graded_at        = NULL,
           review_complete  = 0,
           reviewed_at      = NULL,
           points_earned    = NULL,
           points_possible  = NULL,
           progress_status  = 'in_progress',
           test_reopen_until = NULL
       WHERE id = ?`,
      [instanceId]
    );

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
         ai.test_start_at,
         ai.test_duration_minutes,
         ai.test_reopen_until,
         ai.submitted_at,
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
    console.log("Active student ID for instance", instanceId, "is", activeStudentId);
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

    // Look up whether this activity is a test
    const [[activityRow]] = await conn.query(
      `SELECT is_test FROM pogil_activities WHERE id = ?`,
      [activityId]
    );

    // Treat either a DB flag *or* explicit timing info as "this is a test".
    let isTest = !!activityRow?.is_test;
    if (testStartAt && Number(testDurationMinutes) > 0) {
      isTest = true;
    }

    // 🔹 Normalize incoming testStartAt (ISO) -> MySQL DATETIME string
    let testStartForDb = null;
    let effectiveDuration = 0;

    if (isTest && testStartAt && Number(testDurationMinutes) > 0) {
      const d = new Date(testStartAt);            // parses "2025-12-04T01:37:00.000Z" etc.
      if (!Number.isNaN(d.getTime())) {
        // store as UTC in "YYYY-MM-DD HH:MM:SS"
        testStartForDb = d.toISOString().slice(0, 19).replace('T', ' ');
        effectiveDuration = Number(testDurationMinutes);
      }
    }

    // Keep pogil_activities.is_test in sync (no sheet parsing on the server).
    await conn.query(
      `UPDATE pogil_activities SET is_test = ? WHERE id = ?`,
      [isTest ? 1 : 0, activityId]
    );

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
           (course_id, activity_id, status, group_number, test_start_at, test_duration_minutes)
         VALUES (?, ?, 'in_progress', ?, ?, ?)`,
        [
          courseId,
          activityId,
          group_number,
          testStartForDb,      // ✅ MySQL-friendly string or null
          effectiveDuration    // ✅ 0 if not a test
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
    return res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error setting up groups:', err);
    return res.status(500).json({ error: 'Failed to setup groups' });
  } finally {
    conn.release();
  }
}



async function submitGroupResponses(req, res) {
  const { instanceId } = req.params;
  const { studentId, answers } = req.body;

  if (!instanceId || !studentId || !answers) {
    return res.status(400).json({ error: 'Missing data' });
  }

  try {
    const responseMap = new Map();
    const grouped = {};

    // Group answers by base question id (e.g., 2a from 2aFA1)
    for (const [qid, value] of Object.entries(answers)) {
      const baseMatch = qid.match(/^([0-9]+[a-zA-Z])/); // 2a from 2aFA1
      const base = baseMatch ? baseMatch[1] : null;
      if (!base) continue;

      if (!grouped[base]) grouped[base] = {};
      grouped[base][qid] = value;
    }

    // Build response map + per-question state (2aS) + group state (2state, 3state, ...)
    for (const [base, group] of Object.entries(grouped)) {
      let hasMain = false;
      let allFollowupsAnswered = true;

      for (const [qid, value] of Object.entries(group)) {
        responseMap.set(qid, value);

        if (qid === base && value.trim().length > 0) {
          hasMain = true;
        }

        const fMatch = qid.match(/^([0-9]+[a-zA-Z])F(\d+)$/);
        if (fMatch) {
          const followupNum = fMatch[2];
          const faKey = `${base}FA${followupNum}`;
          if (!group[faKey] || group[faKey].trim().length === 0) {
            allFollowupsAnswered = false;
          }
        }
      }

      const isComplete = hasMain && allFollowupsAnswered;

      // Per-question completion marker (e.g., 2aS)
      responseMap.set(`${base}S`, isComplete ? 'completed' : 'inprogress');

      // Per-group completion marker (e.g., 2state)
      const groupNum = base.match(/^(\d+)/)?.[1];
      if (groupNum) {
        const groupStateKey = `${groupNum}state`;
        if (!responseMap.has(groupStateKey)) {
          responseMap.set(groupStateKey, isComplete ? 'completed' : 'inprogress');
        } else if (responseMap.get(groupStateKey) !== 'completed' && isComplete) {
          responseMap.set(groupStateKey, 'completed');
        }
      }
    }

    // Upsert all responses
    for (const [qid, response] of responseMap.entries()) {
      await db.query(
        `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
         VALUES (?, ?, 'text', ?, ?)
         ON DUPLICATE KEY UPDATE response = VALUES(response), updated_at = CURRENT_TIMESTAMP`,
        [instanceId, qid, response, studentId]
      );
    }

    // 🔹 NEW: recompute cached group progress for this instance
    // This is per-instance only, so cheap even if we hit responses.
    const [[meta]] = await db.query(
      `SELECT total_groups FROM activity_instances WHERE id = ?`,
      [instanceId]
    );

    const totalGroups = meta?.total_groups || 0;

    let completedGroups = 0;
    if (totalGroups > 0) {
      const [stateRows] = await db.query(
        `SELECT question_id, response
         FROM responses
         WHERE activity_instance_id = ?
           AND question_id REGEXP '^[0-9]+state$'`,
        [instanceId]
      );

      const stateMap = new Map(
        stateRows.map(r => [r.question_id, r.response])
      );

      for (let i = 1; i <= totalGroups; i++) {
        const key = `${i}state`;
        if (stateMap.get(key) === 'completed') {
          completedGroups++;
        } else {
          // Assume groups are sequential; stop at first incomplete
          break;
        }
      }
    }

    let progressStatus = 'in_progress';
    if (totalGroups > 0 && completedGroups >= totalGroups) {
      progressStatus = 'completed';
    }

    await db.query(
      `UPDATE activity_instances
       SET completed_groups = ?, progress_status = ?
       WHERE id = ?`,
      [completedGroups, progressStatus, instanceId]
    );

    // 🔄 Rotate active student among connected members (unchanged)
    const [connected] = await db.query(
      `SELECT student_id FROM group_members WHERE activity_instance_id = ? AND connected = true`,
      [instanceId]
    );

    if (connected.length > 0) {
      const eligible = connected.filter(m => m.student_id !== studentId);
      const pickFrom = eligible.length > 0 ? eligible : connected;
      const next = pickFrom[Math.floor(Math.random() * pickFrom.length)].student_id;

      await db.query(
        `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
        [next, instanceId]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ submitGroupResponses:", err);
    res.status(500).json({ error: 'Failed to save responses' });
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
        }
      }

      const [responses] = await db.query(
        `SELECT question_id, response FROM responses WHERE activity_instance_id = ?`,
        [inst.instance_id]
      );

      let progress = '1';
      const totalGroups = inst.total_groups || 1;

      let completedGroups = 0;
      for (let i = 1; i <= totalGroups; i++) {
        const state = responses.find(r => r.question_id === `${i}state`);
        if (state?.response === 'completed') {
          completedGroups++;
        } else {
          break;
        }
      }

      progress = completedGroups === totalGroups ? 'Complete' : `${completedGroups + 1}`;

      const roleLabels = { qc: 'Quality Control' };
      groups.push({
        instance_id: inst.instance_id,
        group_number: inst.group_number,
        active_student_id: activeId,
        progress,
        test_start_at: inst.test_start_at,
        test_duration_minutes: inst.test_duration_minutes,
        test_reopen_until: inst.test_reopen_until,
        submitted_at: inst.submitted_at,
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
       SET test_reopen_until = ?
       WHERE id = ?`,
      [reopenUntil, instanceId]
    );

    return res.json({ ok: true, test_reopen_until: reopenUntil });
  } catch (err) {
    console.error('❌ reopenInstance error:', err);
    return res.status(500).json({ error: 'Failed to reopen test.' });
  }
}

// Regrade a test instance using stored responses (no student participation)
async function regradeTestInstance(req, res) {
  const { instanceId } = req.params;
  const { questions = [] } = req.body || {};

  if (!instanceId) {
    return res.status(400).json({ error: 'Missing instanceId' });
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Missing questions metadata for regrade' });
  }

  console.log('🔁 regradeTestInstance for', instanceId, 'questions:', questions.length);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Load all stored responses for this instance
    const [rows] = await conn.query(
      `SELECT question_id, response, response_type
       FROM responses
       WHERE activity_instance_id = ?`,
      [instanceId]
    );

    const answers = {};
    for (const row of rows) {
      // Use the same keys submitTest uses, e.g. "1", "1code1", "1Output", etc.
      answers[row.question_id] = row.response ?? '';
    }

    const upsertResponse = async (qid, value, type = 'text') => {
      if (value == null || String(value).trim() === '') return;
      await conn.query(
        `
        INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
        VALUES (?, ?, ?, ?, NULL)
        ON DUPLICATE KEY UPDATE
          response      = VALUES(response),
          response_type = VALUES(response_type),
          updated_at    = CURRENT_TIMESTAMP
      `,
        [instanceId, qid, type, String(value)]
      );
    };

    const bucketPoints = (bucket) => {
      if (!bucket) return 0;
      if (typeof bucket === 'number') return bucket;
      if (typeof bucket === 'object' && typeof bucket.points === 'number') {
        return bucket.points;
      }
      return 0;
    };

    let totalEarnedPoints = 0;
    let totalMaxPoints = 0;
    const questionResults = [];

    for (const q of questions) {
      const baseId = q.id || q.qid;
      if (!baseId) {
        console.error('❌ regradeTestInstance: question missing id:', q);
        continue;
      }

      const text = q.text || '';
      const scores = q.scores || {};

      const maxCodePts = bucketPoints(scores.code);
      const maxRunPts = bucketPoints(scores.output);
      const maxRespPts = bucketPoints(scores.response);

      console.log('🧮 [regrade] Question rubric:', {
        qid: baseId,
        scores,
        maxCodePts,
        maxRunPts,
        maxRespPts,
      });

      const written = (answers[baseId] || '').trim();

      const codeCells = [];
      const codePrefix = (baseId + 'code').toLowerCase();

      for (const [key, value] of Object.entries(answers)) {
        if (!value || !String(value).trim()) continue;

        const lowerKey = key.toLowerCase();
        if (!lowerKey.startsWith(codePrefix)) continue;

        const labelMatch = key.match(/code(\d+)$/i);
        const label = labelMatch ? labelMatch[1] : key;

        codeCells.push({
          qid: key,                 // e.g. "1code1"
          code: String(value),
          lang: 'cpp',
          label: `code ${label}`,
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

      console.log('🧪 [regrade] artifacts for', baseId, {
        writtenPresent: !!written,
        codeCellsCount: codeCells.length,
        hasOutput: !!outputText,
      });

      if (maxCodePts <= 0 && maxRunPts <= 0 && maxRespPts <= 0) {
        console.log(
          '⚠️ [regrade] No points configured for question',
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

      console.log('✅ [regrade] result:', {
        instanceId,
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

      // 🔁 Update score/feedback responses
      const upsertScore = async (suffix, value) => {
        if (value == null) return;
        await upsertResponse(`${baseId}${suffix}`, value, 'text');
      };

      await upsertScore('CodeScore', codeScore);
      await upsertScore('CodeFeedback', codeFeedback);

      await upsertScore('RunScore', runScore);
      await upsertScore('RunFeedback', runFeedback);

      await upsertScore('ResponseScore', responseScore);
      await upsertScore('ResponseFeedback', responseFeedback);
    }

    // Build the summary text (same format as submitTest)
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

    console.log('📊 [regrade] summary:', {
      instanceId,
      totalEarnedPoints,
      totalMaxPoints,
    });

    // Store overall totals & summary
    await upsertResponse('testTotalScore', totalEarnedPoints, 'text');
    await upsertResponse('testMaxScore', totalMaxPoints, 'text');
    await upsertResponse('testSummary', summaryText, 'text');

    // Update instance metadata: regraded now, reset review flags
    await conn.query(
      `UPDATE activity_instances
       SET
         points_earned    = ?,
         points_possible  = ?,
         graded_at        = NOW(),
         review_complete  = 0,
         reviewed_at      = NULL
       WHERE id = ?`,
      [totalEarnedPoints, totalMaxPoints, instanceId]
    );

    await conn.commit();
    return res.json({
      ok: true,
      regraded: true,
      earned: totalEarnedPoints,
      max: totalMaxPoints,
      questions: questionResults,
      summary: summaryText,
    });
  } catch (err) {
    await conn.rollback();
    console.error('❌ regradeTestInstance failed:', err);
    return res.status(500).json({ error: 'regrade-test failed' });
  } finally {
    conn.release();
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
      const codePrefix = (baseId + 'code').toLowerCase();

      for (const [key, value] of Object.entries(answers)) {
        if (!value || !String(value).trim()) continue;

        const lowerKey = key.toLowerCase();
        if (!lowerKey.startsWith(codePrefix)) continue;

        const labelMatch = key.match(/code(\d+)$/i);
        const label = labelMatch ? labelMatch[1] : key;

        codeCells.push({
          qid: key,                 // <--- NEW: the exact answer key
          code: String(value),
          lang: 'cpp',
          label: `code ${label}`,
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

    // NEW: cache overall scores on the activity_instance itself
    await conn.query(
      `UPDATE activity_instances
       SET
         points_earned    = ?,
         points_possible  = ?,
         progress_status  = 'completed',
         is_test          = 1,
         submitted_at     = COALESCE(submitted_at, NOW()),
         graded_at        = NOW()
       WHERE id = ?`,
      [totalEarnedPoints, totalMaxPoints, instanceId]
    );


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
           reviewed_at     = NOW()
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
         is_test         = 1,
         submitted_at    = NOW(),
         graded_at       = NOW()
       WHERE id = ?`,
      [totalEarnedPoints ?? 0, totalMaxPoints ?? 0, instanceId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ markTestSubmitted failed:', err);
    return res.status(500).json({ error: 'mark-test-submitted failed' });
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
};
