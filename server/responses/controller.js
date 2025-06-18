// /server/responses/controller.js
const db = require('../db');
const { evaluateCode } = require('../ai/controller');



exports.createResponse = async (req, res) => {
  const { instanceId, questionId, responseText, answeredBy } = req.body;

  try {
    await db.query(
      `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
       VALUES (?, ?, 'text', ?, ?)`,
      [instanceId, questionId, responseText, answeredBy]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving response:", err);
    res.status(500).json({ error: "Failed to save response" });
  }
};

exports.createOrUpdateCodeResponse = async (req, res) => {
  const { activity_instance_id, question_id, user_id, response } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Step 1: Insert or update the response
    const [result] = await conn.query(
      `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
       VALUES (?, ?, 'python', ?, ?)
       ON DUPLICATE KEY UPDATE response = VALUES(response)`,
      [activity_instance_id, question_id, response, user_id]
    );

    const [responseRow] = await conn.query(
      `SELECT id FROM responses
       WHERE activity_instance_id = ? AND question_id = ? AND answered_by_user_id = ?`,
      [activity_instance_id, question_id, user_id]
    );

    const responseId = responseRow?.[0]?.id;
    if (!responseId) throw new Error('Missing response ID');

    // Step 2: Call AI to evaluate code
    const aiData = await evaluateCode({
      questionText: "Review the student's code and offer helpful feedback if needed.",
      studentCode: response,
      codeVersion: question_id,
    });

    const feedbackText = aiData.feedback || '';


    // Step 3: Save feedback to feedback table
    await conn.query(
      `INSERT INTO feedback (response_id, feedback_text)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE feedback_text = VALUES(feedback_text)`,
      [responseId, feedbackText]
    );

    await conn.commit();

    res.json({ success: true, feedback: feedbackText });
  } catch (err) {
    console.error("❌ Error saving code or feedback:", err);
    await conn.rollback();
    res.status(500).json({ error: "Failed to save code response or feedback" });
  } finally {
    conn.release();
  }
};




exports.getResponsesByInstanceId = async (req, res) => {
  const { instanceId } = req.params;

  try {
    // Get the active student ID
    // ✅ Fetch all responses from all group members
    const [rows] = await db.query(
      `SELECT r.question_id, r.response, r.response_type, f.feedback_text AS python_feedback
   FROM responses r
   LEFT JOIN feedback f ON f.response_id = r.id
   WHERE r.activity_instance_id = ?`,
      [instanceId]
    );


    const result = {};
    for (const row of rows) {
      result[row.question_id] = {
        response: row.response,
        type: row.response_type,
        python_feedback: row.python_feedback || null,
      };
    }

    res.json(result);
  } catch (err) {
    console.error("❌ Error fetching responses:", err);
    res.status(500).json({ error: "Failed to fetch responses" });
  }
};


exports.getResponsesByQuestionId = async (req, res) => {
  const { instanceId, questionId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT * FROM responses WHERE activity_instance_id = ? AND question_id = ?`,
      [instanceId, questionId]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching responses:", err);
    res.status(500).json({ error: "Failed to fetch responses" });
  }
};

exports.getResponsesByAnsweredBy = async (req, res) => {
  const { instanceId, answeredBy } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT * FROM responses WHERE activity_instance_id = ? AND answered_by_user_id = ?`,
      [instanceId, answeredBy]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching responses:", err);
    res.status(500).json({ error: "Failed to fetch responses" });
  }
};

// Updated getGroupResponses function to remove old group_id reference
exports.getGroupResponses = async (req, res) => {
  const { instanceId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT question_id, response, response_type FROM responses
       WHERE activity_instance_id = ? AND answered_by_user_id IN (
         SELECT student_id FROM group_members WHERE activity_instance_id = ?
       )`,
      [instanceId, instanceId]
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
};



exports.bulkSaveResponses = async (req, res) => {
  const { instanceId, userId, answers } = req.body;

  try {
    const entries = Object.entries(answers);
    for (const [questionId, responseText] of entries) {
      // 🛑 Skip saving if this is a follow-up (prompt or answer) that already exists
      const isFollowup = /^(\d+[a-z]F\d*)$/.test(questionId); // Matches both F1 and FA1
      if (isFollowup) {
        const [existing] = await db.query(
          `SELECT id FROM responses WHERE activity_instance_id = ? AND question_id = ?`,
          [instanceId, questionId]
        );
        if (existing.length > 0) {
          continue; // Already saved via socket; skip to avoid duplicates
        }
      }

      // ✅ Save or update the response
      await db.query(
        `INSERT INTO responses (activity_instance_id, question_id, response_type, response, answered_by_user_id)
         VALUES (?, ?, 'text', ?, ?)
         ON DUPLICATE KEY UPDATE response = VALUES(response)`,
        [instanceId, questionId, responseText, userId]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to bulk save responses:", err);
    res.status(500).json({ error: "Failed to bulk save" });
  }
};
