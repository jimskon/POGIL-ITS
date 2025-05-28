//server/activity_instances/controller.js
const db = require('../db');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { google } = require('googleapis');
const { authorize } = require('../utils/googleAuth');

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

// ========== ROUTE CONTROLLERS ==========

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
      `SELECT ai.id, ai.course_id, ai.activity_id, ai.group_number, a.name AS activity_name, a.sheet_url
       FROM activity_instances ai
       JOIN pogil_activities a ON ai.activity_id = a.id
       WHERE ai.id = ?`,
      [id]
    );
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    res.json(instance);
  } catch (err) {
    console.error("❌ Failed to fetch activity instance:", err);
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

  try {
    await db.query(
      `UPDATE group_members
       SET last_heartbeat = NOW(), connected = TRUE
       WHERE student_id = ? AND activity_instance_id = ?`,
      [userId, instanceId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to update heartbeat:', err);
    res.status(500).json({ error: 'Failed to record heartbeat' });
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
    const [members] = await db.query(`SELECT student_id FROM group_members WHERE activity_instance_id = ?`, [instanceId]);

    if (!members.length) return res.status(404).json({ error: 'No group members' });

    const others = members.filter(m => m.student_id !== currentStudentId);
    const next = others.length ? others[Math.floor(Math.random() * others.length)] : members[0];

    await db.query(`UPDATE activity_instances SET active_student_id = ? WHERE id = ?`, [next.student_id, instanceId]);
    res.json({ activeStudentId: next.student_id });
  } catch (err) {
    console.error("❌ rotateActiveStudent:", err);
    res.status(500).json({ error: 'Failed to rotate' });
  }
}

async function setupMultipleGroupInstances(req, res) {
  const { activityId, courseId, groups } = req.body;

  if (!activityId || !courseId || !groups?.length) {
    return res.status(400).json({ error: 'Missing data' });
  }

  try {
    const instanceIds = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const [result] = await db.query(
        `INSERT INTO activity_instances (activity_id, course_id, group_number) VALUES (?, ?, ?)`,
        [activityId, courseId, i + 1]
      );
      const instanceId = result.insertId;
      instanceIds.push(instanceId);

      for (const member of group.members) {
        await db.query(`INSERT INTO group_members (activity_instance_id, student_id, role) VALUES (?, ?, ?)`,
          [instanceId, member.student_id, member.role]);
      }

      const random = group.members[Math.floor(Math.random() * group.members.length)];
      await db.query(`UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
        [random.student_id, instanceId]);
    }
    res.json({ success: true, instanceIds });
  } catch (err) {
    console.error("❌ setupMultipleGroupInstances:", err);
    res.status(500).json({ error: 'Failed to setup instances' });
  }
}

async function submitGroupResponses(req, res) {
  const { instanceId } = req.params;
  const { studentId, groupIndex, answers } = req.body;

  if (!instanceId || !studentId || !answers || typeof groupIndex !== 'number') {
    return res.status(400).json({ error: 'Missing data' });
  }

  try {
    const groupStateId = `${groupIndex + 1}state`;
    const [[existing]] = await db.query(
      `SELECT response FROM responses WHERE activity_instance_id = ? AND question_id = ?`,
      [instanceId, groupStateId]
    );
    if (existing?.response === 'complete') {
      return res.status(400).json({ error: 'Already completed' });
    }

    for (const [questionId, value] of Object.entries(answers)) {
      const type = questionId.endsWith('code') ? 'python' : 'text';
      await db.query(
        `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE response = VALUES(response), updated_at = CURRENT_TIMESTAMP`,
        [instanceId, questionId, type, value, studentId]
      );
    }


    await db.query(
      `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
       VALUES (?, ?, 'text', 'complete', ?)
       ON DUPLICATE KEY UPDATE response = VALUES(response), updated_at = CURRENT_TIMESTAMP`,
      [instanceId, groupStateId, studentId]
    );
    // Rotate to a new active student if possible
    const [connected] = await db.query(
      `SELECT student_id FROM group_members
       WHERE activity_instance_id = ? AND connected = true`,
      [instanceId]
    );

    if (connected.length > 0) {
      // Exclude current student if others are available
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

    res.json({
      groups: [{
        group_id: instanceId,
        group_number: 1,
        members: rows.map(r => ({
          student_id: r.student_id,
          name: r.student_name,
          email: r.student_email,
          role: r.role
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
    const [instances] = await db.query(
      `SELECT id AS instance_id, group_number
       FROM activity_instances
       WHERE course_id = ? AND activity_id = ?
       ORDER BY group_number`,
      [courseId, activityId]
    );

    const groups = [];
    for (const inst of instances) {
      const [members] = await db.query(
        `SELECT gm.student_id, gm.role, u.name AS student_name, u.email AS student_email
         FROM group_members gm
         JOIN users u ON gm.student_id = u.id
         WHERE gm.activity_instance_id = ?
         ORDER BY gm.role`,
        [inst.instance_id]
      );
      groups.push({
        instance_id: inst.instance_id,
        group_number: inst.group_number,
        members: members.map(m => ({
          student_id: m.student_id,
          name: m.student_name,
          email: m.student_email,
          role: m.role
        }))
      });
    }
    res.json({ groups });
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

// Export it as part of the module
module.exports = {
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
  getInstanceResponses
};