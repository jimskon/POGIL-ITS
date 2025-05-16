const db = require('../db');

exports.createResponse = async (req, res) => {
  const { instanceId, groupId, questionId, responseText, answeredBy } = req.body;

  try {
    await db.query(`
      INSERT INTO responses (activity_instance_id, group_id, question_id, response_text, answered_by_user_id)
      VALUES (?, ?, ?, ?, ?)
    `, [instanceId, groupId, questionId, responseText, answeredBy]);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving response:", err);
    res.status(500).json({ error: "Failed to save response" });
  }
};
exports.getResponsesByInstanceId = async (req, res) => {
  const { instanceId } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT * FROM responses WHERE activity_instance_id = ?
    `, [instanceId]);

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching responses:", err);
    res.status(500).json({ error: "Failed to fetch responses" });
  }
};
exports.getResponsesByGroupId = async (req, res) => {
  const { instanceId, groupId } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT * FROM responses WHERE activity_instance_id = ? AND group_id = ?
    `, [instanceId, groupId]);

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching responses:", err);
    res.status(500).json({ error: "Failed to fetch responses" });
  }
};
exports.getResponsesByQuestionId = async (req, res) => {
  const { instanceId, questionId } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT * FROM responses WHERE activity_instance_id = ? AND question_id = ?
    `, [instanceId, questionId]);

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching responses:", err);
    res.status(500).json({ error: "Failed to fetch responses" });
  }
};

exports.getResponsesByAnsweredBy = async (req, res) => {
  const { instanceId, answeredBy } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT * FROM responses WHERE activity_instance_id = ? AND answered_by_user_id = ?
    `, [instanceId, answeredBy]);

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching responses:", err);
    res.status(500).json({ error: "Failed to fetch responses" });
  }
};

// responses/controller.js
exports.getGroupResponses = async (req, res) => {
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


