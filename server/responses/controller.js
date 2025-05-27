// /server/responses/controller.js
const db = require('../db');

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

exports.getResponsesByInstanceId = async (req, res) => {
  const { instanceId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT * FROM responses WHERE activity_instance_id = ?`,
      [instanceId]
    );

    res.json(rows);
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
