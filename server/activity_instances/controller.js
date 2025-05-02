const db = require('../db');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { google } = require('googleapis');
const { authorize } = require('../utils/googleAuth');

function parseGoogleDocHTML(html) {
  const dom = new JSDOM(html);
  const body = dom.window.document.body;
  const blocks = [];

  let currentEnv = null;
  let envBuffer = [];
  let currentQuestion = null;
  let collectingSamples = false;
  let collectingFeedback = false;
  let collectingFollowups = false;
  let currentField = 'text';

  const formatText = (text) =>
    text.replace(/\\textit\{([^}]+)\}/g, '<em>$1</em>')
        .replace(/\\textbf\{([^}]+)\}/g, '<strong>$1</strong>');

  const finalizeEnvironment = () => {
    if (currentEnv) {
      blocks.push({
        type: currentEnv,
        content: envBuffer.map(formatText)
      });
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
    if (envMatch) {
      finalizeEnvironment();
      currentEnv = envMatch[1];
      continue;
    }

    if (currentEnv && text === `\\end{${currentEnv}}`) {
      finalizeEnvironment();
      continue;
    }

    if (currentEnv) {
      if (text.startsWith('\\item')) {
        envBuffer.push(`<li>${formatText(text.replace(/^\\item\s*/, ''))}</li>`);
      } else {
        envBuffer.push(text);
      }
      continue;
    }

    if (text.startsWith('\\title{') || text.startsWith('\\name{') || text.startsWith('\\section{')) {
      const type = text.match(/^\\(\w+)\{/)[1];
      const value = text.match(/\\\w+\{(.+?)\}/)?.[1];
      blocks.push({ type: 'header', field: type, content: value });
      continue;
    }

    if (text.startsWith('\\begin{question}')) {
      finalizeQuestion();
      const id = text.match(/\\begin\{question\}\{(.+?)\}/)?.[1] || `q${blocks.length + 1}`;
      currentQuestion = {
        id,
        text: '',
        samples: [],
        feedback: [],
        followups: [],
        responseLines: 1
      };
      continue;
    }

    if (text.startsWith('\\textresponse')) {
      const match = text.match(/\\textresponse\{.+?,(\d+)\}/);
      if (match) currentQuestion.responseLines = parseInt(match[1]);
      continue;
    }

    if (text === '\\sampleresponses') {
      collectingSamples = true;
      currentField = 'samples';
      continue;
    }
    if (text === '\\endsampleresponses') {
      collectingSamples = false;
      currentField = 'text';
      continue;
    }

    if (text === '\\feedbackprompt') {
      collectingFeedback = true;
      currentField = 'feedback';
      continue;
    }
    if (text === '\\endfeedbackprompt') {
      collectingFeedback = false;
      currentField = 'text';
      continue;
    }

    if (text === '\\followupprompt') {
      collectingFollowups = true;
      currentField = 'followups';
      continue;
    }
    if (text === '\\endfollowupprompt') {
      collectingFollowups = false;
      currentField = 'text';
      continue;
    }

    if (text === '\\end{question}') {
      finalizeQuestion();
      continue;
    }

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

exports.getParsedActivityDoc = async (req, res) => {
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

    const html = doc.data.body.content
      .map(block => {
        if (!block.paragraph?.elements) return null;
        const text = block.paragraph.elements
          .map(e => e.textRun?.content || '')
          .join('')
          .trim();
        return text.length > 0 ? `<p>${text}</p>` : null;
      })
      .filter(Boolean)
      .join('\n');

    const blocks = parseGoogleDocHTML(html);
    res.json({ lines: blocks });
  } catch (err) {
    console.error("❌ Error parsing activity doc:", err);
    res.status(500).json({ error: 'Failed to load document' });
  }
};

// POST /api/activity-instances
exports.createActivityInstance = async (req, res) => {
  const { activityName, courseId, userId } = req.body;

  try {
    // 1. Look up activity
    const [[activity]] = await db.query(
      `SELECT id FROM pogil_activities WHERE name = ?`,
      [activityName]
    );

    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    // 2. Check for existing instance
    const [[instance]] = await db.query(
      `SELECT id FROM activity_instances WHERE activity_id = ? AND course_id = ? AND group_number IS NULL`,
      [activity.id, courseId]
    );

    if (instance) {
      return res.json({ instanceId: instance.id });
    }

    // 3. Create new instance
    const [result] = await db.query(
      `INSERT INTO activity_instances (activity_id, course_id, group_number) VALUES (?, ?, NULL)`,
      [activity.id, courseId]
    );

    res.json({ instanceId: result.insertId });

  } catch (err) {
    console.error("❌ Failed to create activity instance:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getEnrolledStudents = async (req, res) => {
  const { id } = req.params;

  try {
    const [[instance]] = await db.query(
      `SELECT course_id FROM activity_instances WHERE id = ?`,
      [id]
    );

    if (!instance) {
      return res.status(404).json({ error: 'Activity instance not found' });
    }

    const [students] = await db.query(
      `SELECT u.id, u.name, u.email
       FROM course_enrollments ce
       JOIN users u ON ce.student_id = u.id
       WHERE ce.course_id = ? AND u.role = 'student'`,
      [instance.course_id]
    );

      res.json({students});
  } catch (err) {
    console.error("❌ Failed to fetch enrolled students:", err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
};

// server/activity_instances/controller.js (add this route)

exports.recordHeartbeat = async (req, res) => {
  const { instanceId } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    await db.query(
      `REPLACE INTO activity_heartbeats (activity_instance_id, user_id, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [instanceId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving heartbeat:", err);
    res.status(500).json({ error: 'Failed to record presence' });
  }
};


// GET /api/activity-instances/:instanceId/active-student
exports.getActiveStudent = async (req, res) => {
  const { instanceId } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT ah.user_id, ah.updated_at
      FROM activity_heartbeats ah
      JOIN group_members gm ON ah.user_id = gm.student_id
      JOIN activity_groups ag ON gm.activity_group_id = ag.id
      WHERE ah.activity_instance_id = ?
        AND ah.updated_at >= NOW() - INTERVAL 60 SECOND
      ORDER BY ah.updated_at ASC
    `, [instanceId]);

    if (rows.length === 0) {
      return res.json({ activeStudentId: null });
    }

    const studentIds = [...new Set(rows.map(r => r.user_id))];
    const now = Date.now();
    const index = Math.floor(now / 60000) % studentIds.length;
    const activeStudentId = studentIds[index];

    res.json({ activeStudentId });
  } catch (err) {
    console.error("❌ Failed to determine active student:", err);
    res.status(500).json({ error: 'Failed to determine active student' });
  }
};


exports.getActivityInstanceById = async (req, res) => {
  const { id } = req.params;
console.log("🔍 Instance ID:", id);
  try {
    const [[instance]] = await db.query(`
      SELECT ai.id, ai.course_id, a.name AS activity_name
      FROM activity_instances ai
      JOIN pogil_activities a ON ai.activity_id = a.id
      WHERE ai.id = ?
    `, [id]);

    if (!instance) {
      return res.status(404).json({ error: "Instance not found" });
    }

    res.json(instance);
  } catch (err) {
    console.error("❌ Failed to fetch activity instance:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};


exports.setupGroupsForInstance = async (req, res) => {
  const { id: instanceId } = req.params;
  const { groups } = req.body;

// 🧹 Delete existing groups and their members first
const [existingGroups] = await db.query(
  `SELECT id FROM activity_groups WHERE activity_instance_id = ?`,
  [instanceId]
);

const groupIds = existingGroups.map(g => g.id);
if (groupIds.length > 0) {
  await db.query(
    `DELETE FROM group_members WHERE activity_group_id IN (?)`,
    [groupIds]
  );
  await db.query(
    `DELETE FROM activity_groups WHERE activity_instance_id = ?`,
    [instanceId]
  );
}

  // ✅ Validate group structure and size
  if (
    !Array.isArray(groups) ||
    groups.length === 0 ||
    groups.flatMap(g => g.members || []).length < 4
  ) {
    return res.status(400).json({ error: 'At least 4 students are required' });
  }

  try {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];

      // ✅ Provide group_number to satisfy UNIQUE(activity_instance_id, group_number)
      const [groupResult] = await db.query(
        `INSERT INTO activity_groups (activity_instance_id, group_number) VALUES (?, ?)`,
        [instanceId, i + 1]
      );

      const groupId = groupResult.insertId;

      // ✅ Insert group members
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
};
