// activity_instances/controller.js
const db = require('../db');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { google } = require('googleapis');
const { authorize } = require('../utils/googleAuth');

function parseGoogleDocHTML(html) {
  const dom = new JSDOM(html);
  const body = dom.window.document.body;
  const blocks = [];

  let currentEnv = null, envBuffer = [], currentQuestion = null;
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
  const { activityId, courseId } = req.body;
  console.log("Creating activity instance with:", { activityId, courseId });
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
      `SELECT ai.id, ai.course_id, ai.activity_id, a.name AS activity_name, a.sheet_url
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
    const [[instance]] = await db.query(
      `SELECT course_id FROM activity_instances WHERE id = ?`,
      [id]
    );

    if (!instance) return res.status(404).json({ error: 'Activity instance not found' });

    const [students] = await db.query(
      `SELECT u.id, u.name, u.email
       FROM course_enrollments ce
       JOIN users u ON ce.student_id = u.id
       WHERE ce.course_id = ? AND u.role = 'student'`,
      [instance.course_id]
    );

    res.json({ students });
  } catch (err) {
    console.error("❌ Failed to fetch enrolled students:", err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
}
// Update student heartbeat timestamp
async function recordHeartbeat(req, res) {
  const { instanceId } = req.params;
  const { userId, groupId } = req.body;

  if (!userId || !groupId) {
    return res.status(400).json({ error: 'Missing userId or groupId' });
  }

  try {
    await db.query(
      `UPDATE group_members SET last_heartbeat = NOW()
       WHERE student_id = ? AND activity_instance_id = ?`,
      [userId, groupId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to update heartbeat:', err);
    res.status(500).json({ error: 'Failed to record heartbeat' });
  }
}

async function getActiveStudent(req, res) {
  const { instanceId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: No user ID' });
  }

  try {
    // Step 1: Return active student if already assigned and valid
    const [[instance]] = await db.query(
      `SELECT active_student_id FROM activity_instances WHERE id = ?`,
      [instanceId]
    );

    if (instance?.active_student_id) {
      const [[valid]] = await db.query(`
        SELECT 1
        FROM group_members gm
        JOIN activity_groups ag ON gm.activity_group_id = ag.id
        WHERE ag.activity_instance_id = ?
          AND gm.student_id = ?`,
        [instanceId, instance.active_student_id]
      );

      if (valid) {
        return res.json({ activeStudentId: instance.active_student_id });
      }
    }

    // Step 2: Find user's group for this instance
    const [[groupRow]] = await db.query(`
      SELECT ag.id AS group_id
      FROM activity_groups ag
      JOIN group_members gm ON gm.activity_group_id = ag.id
      WHERE ag.activity_instance_id = ? AND gm.student_id = ?`,
      [instanceId, userId]
    );

    if (!groupRow) {
      return res.status(404).json({ error: 'User is not in any group for this activity' });
    }

    const groupId = groupRow.group_id;

    // Step 3: Find group members with recent heartbeat (last 30s)
    const [members] = await db.query(`
      SELECT gm.student_id
      FROM group_members gm
      WHERE gm.activity_group_id = ?
        AND (gm.last_heartbeat IS NULL OR gm.last_heartbeat > NOW() - INTERVAL 30 SECOND)`,
      [groupId]
    );

    if (!members.length) {
      return res.status(404).json({ error: 'No currently present group members' });
    }

    // Step 4: Pick one (only or random)
    const selected = members.length === 1
      ? members[0]
      : members[Math.floor(Math.random() * members.length)];

    await db.query(
      `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
      [selected.student_id, instanceId]
    );

    res.json({ activeStudentId: selected.student_id });

  } catch (err) {
    console.error("❌ Failed in getActiveStudent:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getGroupResponses(req, res) {
  const { instanceId, groupId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT question_id, response, response_type
       FROM responses
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
    console.error("❌ Failed to fetch group responses:", err);
    res.status(500).json({ error: 'Failed to fetch group responses' });
  }
}


async function rotateActiveStudent(req, res) {
  const { instanceId } = req.params;
  const { currentStudentId } = req.body;

  if (!currentStudentId) {
    return res.status(400).json({ error: 'Missing currentStudentId' });
  }

  try {
    // Find the group associated with this activity instance
    const [[group]] = await db.query(
      `SELECT id FROM activity_groups WHERE activity_instance_id = ?`,
      [instanceId]
    );

    if (!group) {
      return res.status(404).json({ error: 'No group found for this instance' });
    }

    // Get all group members
    const [members] = await db.query(
      `SELECT student_id FROM group_members WHERE activity_group_id = ?`,
      [group.id]
    );

    if (!members.length) {
      return res.status(404).json({ error: 'No members in group' });
    }

    // Pick a new student different from the current one
    const others = members.filter(m => m.student_id !== currentStudentId);
    const next = others.length > 0
      ? others[Math.floor(Math.random() * others.length)]
      : members[0]; // fallback to current if alone

    // Update active student
    await db.query(
      `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
      [next.student_id, instanceId]
    );

    res.json({ activeStudentId: next.student_id });

  } catch (err) {
    console.error("❌ Failed to rotate active student:", err);
    res.status(500).json({ error: 'Failed to rotate active student' });
  }
}

/**
 * POST /api/activity-instances/:id/setup-groups
 * Request body:
 * {
 *   students: [ { id: number, name: string, email: string } ]
 * }
 *
 * This controller function:
 * - Takes a list of selected students.
 * - Randomizes and splits them into groups of 4 (or fewer, with fallback).
 * - Creates one activity_group per group.
 * - Assigns roles: facilitator, spokesperson, analyst, qc (reused or merged for small groups).
 * - Inserts group_members.
 * - Sets one random student per group as active_student_id in the instance table.
 */

async function setupGroupsForInstance(req, res) {
  const { id: instanceId } = req.params;
  const { students } = req.body;

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'Student list is empty or invalid' });
  }

  try {
    // 1. Shuffle students randomly
    const shuffled = students.sort(() => Math.random() - 0.5);

    // 2. Break into groups of 4
    const groups = [];
    while (shuffled.length) {
      groups.push(shuffled.splice(0, 4));
    }

    // 3. Cleanup any existing groups
    const [existingGroups] = await db.query(
      'SELECT id FROM activity_groups WHERE activity_instance_id = ?',
      [instanceId]
    );
    const groupIds = existingGroups.map(g => g.id);
    if (groupIds.length) {
      await db.query('DELETE FROM group_members WHERE activity_group_id IN (?)', [groupIds]);
      await db.query('DELETE FROM activity_groups WHERE activity_instance_id = ?', [instanceId]);
    }

    // 4. Role assignment logic
    const roleSets = {
      1: ['facilitator'],
      2: ['facilitator', 'analyst'],
      3: ['facilitator', 'spokesperson', 'analyst'],
      4: ['facilitator', 'spokesperson', 'analyst', 'qc']
    };

    // 5. Create new groups
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const [result] = await db.query(
        'INSERT INTO activity_groups (activity_instance_id, group_number) VALUES (?, ?)',
        [instanceId, i + 1]
      );
      const groupId = result.insertId;
      const roles = roleSets[group.length] || roleSets[4];

      for (let j = 0; j < group.length; j++) {
        const student = group[j];
        const role = roles[j % roles.length];
        await db.query(
          'INSERT INTO group_members (activity_group_id, student_id, role) VALUES (?, ?, ?)',
          [groupId, student.id, role]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to set up groups:', err);
    res.status(500).json({ error: 'Failed to set up groups' });
  }
}

async function setupMultipleGroupInstances(req, res) {
  const { activityId, courseId, groups } = req.body;
  console.log("📥 Received setup request:", { activityId, courseId, groups });

  if (!activityId || !courseId || !Array.isArray(groups) || groups.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid activityId, courseId, or groups' });
  }

  try {
    const instanceIds = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];

      // 1. Create a new activity_instance for this group
      const [instanceResult] = await db.query(
        `INSERT INTO activity_instances (activity_id, course_id) VALUES (?, ?)`,
        [activityId, courseId]
      );
      const instanceId = instanceResult.insertId;
      instanceIds.push(instanceId);

      // 2. Create one activity_group for this instance
      const [groupResult] = await db.query(
        `INSERT INTO activity_groups (activity_instance_id, group_number) VALUES (?, ?)`,
        [instanceId, 1]
      );
      const groupId = groupResult.insertId;

      // 3. Insert group_members with roles
      for (const member of group.members) {
        await db.query(
          `INSERT INTO group_members (activity_group_id, student_id, role)
           VALUES (?, ?, ?)`,
          [groupId, member.student_id, member.role]
        );
      }

      // 4. Assign one active student (random)
      const random = group.members[Math.floor(Math.random() * group.members.length)];
      await db.query(
        `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
        [random.student_id, instanceId]
      );
    }

    res.json({ success: true, instanceIds });
  } catch (err) {
    console.error('❌ Failed to setup multiple activity instances:', err);
    res.status(500).json({ error: 'Failed to setup group instances' });
  }
}

async function submitGroupResponses(req, res) {
  const { instanceId } = req.params;
  const { groupId, groupIndex, studentId, answers } = req.body;

  if (!instanceId || !groupId || !studentId || !answers || typeof groupIndex !== 'number') {
    return res.status(400).json({ error: 'Missing required submission fields' });
  }

  try {
    const groupStateId = `${groupIndex + 1}state`;

    // Check if already completed
    const [[existing]] = await db.query(
      `SELECT response FROM responses
       WHERE activity_instance_id = ? AND group_id = ? AND question_id = ?`,
      [instanceId, groupId, groupStateId]
    );

    if (existing?.response === 'complete') {
      return res.status(400).json({ error: 'This group has already completed this section.' });
    }

    // Save each question response
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

    // Mark group as complete
    await db.query(
      `INSERT INTO responses (activity_instance_id, question_id, response_type, response, group_id, answered_by_user_id)
       VALUES (?, ?, 'text', 'complete', ?, ?)
       ON DUPLICATE KEY UPDATE response = VALUES(response), updated_at = CURRENT_TIMESTAMP`,
      [instanceId, groupStateId, groupId, studentId]
    );

    // Rotate to next active student
    const [members] = await db.query(
      `SELECT student_id FROM group_members WHERE activity_group_id = ?`,
      [groupId]
    );

    if (members.length > 1) {
      const others = members.filter(m => m.student_id !== studentId);
      const next = others.length > 0
        ? others[Math.floor(Math.random() * others.length)]
        : members[0];

      await db.query(
        `UPDATE activity_instances SET active_student_id = ? WHERE id = ?`,
        [next.student_id, instanceId]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to submit group responses:', err);
    res.status(500).json({ error: 'Failed to submit group responses' });
  }
}

async function getInstanceGroups(req, res) {
  const { instanceId } = req.params;

  if (!instanceId) {
    return res.status(400).json({ error: 'Missing instanceId' });
  }

  try {
    // Query group and member info
    const [rows] = await db.query(
      `SELECT 
         ag.id AS group_id,
         ag.group_number,
         gm.student_id,
         gm.role,
         u.name AS student_name,
         u.email AS student_email
       FROM activity_groups ag
       JOIN group_members gm ON gm.activity_group_id = ag.id
       JOIN users u ON u.id = gm.student_id
       WHERE ag.activity_instance_id = ?
       ORDER BY ag.group_number, gm.role`,
      [instanceId]
    );

    // Group by group_number
    const groups = {};
    for (const row of rows) {
      if (!groups[row.group_number]) {
        groups[row.group_number] = {
          group_id: row.group_id,
          group_number: row.group_number,
          members: []
        };
      }
      groups[row.group_number].members.push({
        student_id: row.student_id,
        name: row.student_name,
        email: row.student_email,
        role: row.role
      });
    }

    const result = Object.values(groups);
    res.json({ groups: result });
  } catch (err) {
    console.error('❌ Failed to get instance groups:', err);
    res.status(500).json({ error: 'Failed to fetch instance groups' });
  }
}


module.exports = {
  getParsedActivityDoc,
  createActivityInstance,
  getActivityInstanceById,
  getEnrolledStudents,
  recordHeartbeat,
  getActiveStudent,
  getGroupResponses,
  rotateActiveStudent,
  setupGroupsForInstance,
  setupMultipleGroupInstances,
  submitGroupResponses,
  getInstanceGroups
};
