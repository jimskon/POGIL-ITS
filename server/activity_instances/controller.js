//activity_instances/controller.js
const db = require('../db');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { google } = require('googleapis');
const { authorize } = require('../utils/googleAuth');

// Helper: Google Doc Parsing
function parseGoogleDocHTML(html) {
  const dom = new JSDOM(html);
  const body = dom.window.document.body;
  const blocks = [];

  let currentEnv = null, envBuffer = [], currentQuestion = null;
  let collectingSamples = false, collectingFeedback = false, collectingFollowups = false;
  let currentField = 'text';

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

    if (text.startsWith('\\begin{question}')) {
      finalizeQuestion();
      const id = text.match(/\\begin\{question\}\{(.+?)\}/)?.[1] || `q${blocks.length + 1}`;
      currentQuestion = { id, text: '', samples: [], feedback: [], followups: [], responseLines: 1 };
      continue;
    }

    if (text.startsWith('\\textresponse')) {
      const match = text.match(/\\textresponse\{.+?,(\d+)\}/);
      if (match) currentQuestion.responseLines = parseInt(match[1]);
      continue;
    }

    if (text === '\\sampleresponses') { collectingSamples = true; currentField = 'samples'; continue; }
    if (text === '\\endsampleresponses') { collectingSamples = false; currentField = 'text'; continue; }
    if (text === '\\feedbackprompt') { collectingFeedback = true; currentField = 'feedback'; continue; }
    if (text === '\\endfeedbackprompt') { collectingFeedback = false; currentField = 'text'; continue; }
    if (text === '\\followupprompt') { collectingFollowups = true; currentField = 'followups'; continue; }
    if (text === '\\endfollowupprompt') { collectingFollowups = false; currentField = 'text'; continue; }

    if (text === '\\end{question}') { finalizeQuestion(); continue; }

    if (currentQuestion) {
      if (currentField === 'text') {
        currentQuestion.text += (currentQuestion.text ? ' ' : '') + formatText(text);
      } else {
        currentQuestion[currentField].push(formatText(text));
      }
      continue;
    }

    blocks.push({ type: 'info', content: formatText(text) });
  }

  finalizeQuestion();
  finalizeEnvironment();
  return blocks;
}

// ------------------ Controller Methods ------------------

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

    const sheetUrl = rows[0].sheet_url;
    const docId = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
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
  const { activityName, courseId } = req.body;

  try {
    const [[activity]] = await db.query(`SELECT id FROM pogil_activities WHERE name = ?`, [activityName]);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    const [[instance]] = await db.query(
      `SELECT id FROM activity_instances WHERE activity_id = ? AND course_id = ?`,
      [activity.id, courseId]
    );

    if (instance) return res.json({ instanceId: instance.id });

    const [result] = await db.query(
      `INSERT INTO activity_instances (activity_id, course_id) VALUES (?, ?)`,
      [activity.id, courseId]
    );

    res.json({ instanceId: result.insertId });
  } catch (err) {
    console.error("❌ Failed to create activity instance:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getActivityInstanceById(req, res) {
  const { id } = req.params;

  try {
    const [[instance]] = await db.query(`
      SELECT ai.id, ai.course_id, ai.activity_id, a.name AS activity_name, a.sheet_url
      FROM activity_instances ai
      JOIN pogil_activities a ON ai.activity_id = a.id
      WHERE ai.id = ?
    `, [id]);

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
    const [[instance]] = await db.query(
      `SELECT course_id FROM activity_instances WHERE id = ?`,
      [id]
    );

    if (!instance) return res.status(404).json({ error: 'Activity instance not found' });

    const [students] = await db.query(`
      SELECT u.id, u.name, u.email
      FROM course_enrollments ce
      JOIN users u ON ce.student_id = u.id
      WHERE ce.course_id = ? AND u.role = 'student'
    `, [instance.course_id]);

    res.json({ students });
  } catch (err) {
    console.error("❌ Failed to fetch enrolled students:", err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
}

async function recordHeartbeat(req, res) {
  const { instanceId } = req.params;
  const { userId, groupId } = req.body;

  if (!userId || !groupId) {
    return res.status(400).json({ error: 'Missing userId or groupId' });
  }

  try {
    await db.query(
      `UPDATE group_members SET last_heartbeat = NOW() WHERE student_id = ? AND activity_group_id = ?`,
      [userId, groupId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to record heartbeat:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getActiveStudent(req, res) {
  console.log("📥 getActiveStudent called with instanceId:", req.params.instanceId);

  const { instanceId } = req.params;
  const userId = req.user?.id; // You need to ensure userId is available in the request (e.g., via middleware)

  try {
    // Step 1: If already set and valid, return it
    const [[row]] = await db.query(
      `SELECT active_student_id FROM activity_instances WHERE id = ?`,
      [instanceId]
    );
    console.log("📥 Row:", row);
    if (row?.active_student_id) {
      // Check if this student is in the correct group
      const [[valid]] = await db.query(
        `SELECT 1 FROM group_members gm
         JOIN activity_groups ag ON gm.activity_group_id = ag.id
         WHERE ag.activity_instance_id = ? AND gm.student_id = ?`,
        [instanceId, row.active_student_id]
      );
      console.log("📥 Valid:", valid);
      if (valid) {
        return res.json({ activeStudentId: row.active_student_id });
      }
    }

    // Step 2: Get the group for this user
    const [[groupRow]] = await db.query(
      `SELECT ag.id AS group_id
       FROM activity_groups ag
       JOIN group_members gm ON ag.id = gm.activity_group_id
       WHERE ag.activity_instance_id = ? AND gm.student_id = ?`,
      [instanceId, userId]
    );
    console.log("📥 Group row:", groupRow);

    if (!groupRow) {
      return res.status(404).json({ error: 'User is not in any group for this activity instance' });
    }

    const groupId = groupRow.group_id;

    // Step 3: Get all recently active users in the group (last 30s)
    const [members] = await db.query(
      `SELECT gm.student_id
       FROM group_members gm
       WHERE gm.activity_group_id = ?
         AND gm.last_heartbeat IS NOT NULL
         AND gm.last_heartbeat > NOW() - INTERVAL 30 SECOND`,
      [groupId]
    );

    if (members.length === 0) {
      return res.status(404).json({ error: 'No currently present group members' });
    }

    const selected = members.length === 1
      ? members[0]
      : members[Math.floor(Math.random() * members.length)];

    await db.query(
      `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
      [selected.student_id, instanceId]
    );

    return res.json({ activeStudentId: selected.student_id });

  } catch (err) {
    console.error("❌ Failed to get/set active student:", err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}





async function setActiveStudent(req, res) {
  const { instanceId } = req.params;
  const { activeStudentId } = req.body;

  if (!activeStudentId) {
    return res.status(400).json({ error: 'Missing activeStudentId' });
  }

  try {
    await db.query(
      'UPDATE activity_instances SET active_student_id = ? WHERE id = ?',
      [activeStudentId, instanceId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to set active student:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function rotateActiveStudent(req, res) {
  const { instanceId } = req.params;
  const { groupId, currentStudentId } = req.body;

  if (!groupId || !currentStudentId) {
    return res.status(400).json({ error: 'Missing groupId or currentStudentId' });
  }

  try {
    const [members] = await db.query(
      'SELECT student_id FROM group_members WHERE activity_group_id = ?',
      [groupId]
    );

    if (!members.length) {
      return res.status(404).json({ error: 'No group members found' });
    }

    const others = members.filter(m => m.student_id !== currentStudentId);
    const next = others.length > 0
      ? others[Math.floor(Math.random() * others.length)]
      : members[0];

    await db.query(
      'UPDATE activity_instances SET active_student_id = ? WHERE id = ?',
      [next.student_id, instanceId]
    );

    res.json({ activeStudentId: next.student_id });
  } catch (err) {
    console.error("❌ Failed to rotate active student:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function setupGroupsForInstance(req, res) {
  const { id: instanceId } = req.params;
  const { groups } = req.body;

  const [existingGroups] = await db.query(
    `SELECT id FROM activity_groups WHERE activity_instance_id = ?`,
    [instanceId]
  );

  const groupIds = existingGroups.map(g => g.id);
  if (groupIds.length > 0) {
    await db.query(`DELETE FROM group_members WHERE activity_group_id IN (?)`, [groupIds]);
    await db.query(`DELETE FROM activity_groups WHERE activity_instance_id = ?`, [instanceId]);
  }

  if (!Array.isArray(groups) || groups.length === 0) {
    return res.status(400).json({ error: 'No groups provided' });
  }

  try {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const [groupResult] = await db.query(
        `INSERT INTO activity_groups (activity_instance_id, group_number) VALUES (?, ?)`,
        [instanceId, i + 1]
      );

      const groupId = groupResult.insertId;
      for (const member of group.members) {
        await db.query(
          `INSERT INTO group_members (activity_group_id, student_id, role) VALUES (?, ?, ?)`,
          [groupId, member.student_id, member.role]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error setting up groups:', err);
    res.status(500).json({ error: 'Failed to set up groups' });
  }
}

async function submitGroup(req, res) {
  const { instanceId } = req.params;
  const { groupId, groupIndex, studentId, answers } = req.body;

  try {
    const groupStateId = `${groupIndex + 1}state`;

    // ✅ Check if already complete
    const [[existing]] = await db.query(`
      SELECT response FROM responses
      WHERE activity_instance_id = ? AND group_id = ? AND question_id = ?
    `, [instanceId, groupId, groupStateId]);

    if (existing && existing.response === 'complete') {
      return res.status(400).json({ error: 'This group has already completed this section.' });
    }

    // 🔁 Save individual question responses
    const responseEntries = Object.entries(answers);
    for (const [key, value] of responseEntries) {
      const questionId = `${groupIndex + 1}${key}`;
      const responseType = key.endsWith('code') ? 'python' : 'text';

      await db.query(
        `INSERT INTO responses (activity_instance_id, question_id, response_type, response, group_id, answered_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE response = VALUES(response), updated_at = CURRENT_TIMESTAMP`,
        [instanceId, questionId, responseType, value, groupId, studentId]
      );
    }

    // ✅ Mark group as complete
    await db.query(
      `INSERT INTO responses (activity_instance_id, question_id, response_type, response, group_id, answered_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE response = VALUES(response), updated_at = CURRENT_TIMESTAMP`,
      [instanceId, groupStateId, 'text', 'complete', groupId, studentId]
    );
// 🎯 Rotate to next active student in this group
const [members] = await db.query(
  `SELECT student_id FROM group_members WHERE activity_group_id = ?`,
  [groupId]
);

if (members.length > 1) {
  const others = members.filter(m => m.student_id !== studentId);
  const next = others.length > 0
    ? others[Math.floor(Math.random() * others.length)]
    : members[0]; // fallback to self if solo

  await db.query(
    `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
    [next.student_id, instanceId]
  );
}
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to save responses:', err);
    res.status(500).json({ error: 'Failed to save responses' });
  }
}


async function getGroupResponses(req, res) {
  const { instanceId, groupId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT question_id, response, response_type FROM responses
       WHERE activity_instance_id = ? AND group_id = ?`,
      [instanceId, groupId]
    );

    const result = {};
    for (const row of rows) {
      result[row.question_id] = {
        response: row.response,
        type: row.response_type
      };
    }

    res.json(result);
  } catch (err) {
    console.error("❌ Failed to get group responses:", err);
    res.status(500).json({ error: 'Failed to fetch group responses' });
  }
}


module.exports = {
  getParsedActivityDoc,
  createActivityInstance,
  getActivityInstanceById,
  getEnrolledStudents,
  recordHeartbeat,
  getActiveStudent,
  setActiveStudent,
  rotateActiveStudent,
  setupGroupsForInstance,
  submitGroup,
  getGroupResponses
};
