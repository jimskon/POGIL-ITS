const db = require('../db');

exports.getAllClasses = async (req, res) => {
  const rows = await db.query('SELECT * FROM pogil_classes');
  res.json(rows);
};

exports.createClass = async (req, res) => {
  const { name, description, createdBy } = req.body;
  const result = await db.query(
    'INSERT INTO pogil_classes (name, description, created_by) VALUES (?, ?, ?)',
    [name, description, createdBy]
  );
    res.status(201).json({ id: Number(result.insertId), name, description, created_by: createdBy });
};

exports.updateClass = async (req, res) => {
  const { name, description } = req.body;
  await db.query(
    'UPDATE pogil_classes SET name = ?, description = ? WHERE id = ?',
    [name, description, req.params.id]
  );
  res.json({ id: req.params.id, name, description });
};

exports.deleteClass = async (req, res) => {
  await db.query('DELETE FROM pogil_classes WHERE id = ?', [req.params.id]);
  res.status(204).send();
};

exports.getActivitiesByClass = async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await require('../db').query(
      'SELECT * FROM pogol_activities WHERE class_id = ? ORDER BY order_index',
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching class activities:', err);
    res.status(500).json({ error: 'Failed to retrieve activities for class.' });
  }
};

exports.createActivityForClass = async (req, res) => {
  const classId = req.params.id;
  const { name, title, sheet_url, order_index, createdBy } = req.body;

  console.log("Received POST /classes/:id/activities", {
    name, title, sheet_url, order_index, createdBy, classId
  });

  if (!name || !title || order_index === undefined || createdBy === undefined) {
    return res.status(400).json({
      error: 'Missing required fields',
      received: { name, title, sheet_url, order_index, createdBy }
    });
  }

  try {
    const result = await db.query(
      'INSERT INTO pogol_activities (name, title, sheet_url, order_index, class_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, title, sheet_url, order_index, classId, createdBy]
    );

    res.status(201).json({
      name,
      title,
      sheet_url,
      order_index,
      class_id: Number(classId),
      created_by: createdBy
    });
  } catch (err) {
    console.error('Error creating activity:', err);
    res.status(500).json({ error: 'Failed to create activity.' });
  }
};

exports.updateActivityForClass = async (req, res) => {
  const { id: classId, activityName } = req.params;
  const { title, sheet_url, order_index } = req.body;

  try {
    await require('../db').query(
      'UPDATE pogol_activities SET title = ?, sheet_url = ?, order_index = ? WHERE name = ? AND class_id = ?',
      [title, sheet_url, order_index, activityName, classId]
    );

    res.json({ name: activityName, title, sheet_url, order_index, class_id: classId });
  } catch (err) {
    console.error('Error updating activity:', err);
    res.status(500).json({ error: 'Failed to update activity.' });
  }
};

exports.deleteActivityFromClass = async (req, res) => {
  const { id: classId, activityName } = req.params;

  try {
    await require('../db').query(
      'DELETE FROM pogol_activities WHERE name = ? AND class_id = ?',
      [activityName, classId]
    );

    res.status(204).send();
  } catch (err) {
    console.error('Error deleting activity:', err);
    res.status(500).json({ error: 'Failed to delete activity.' });
  }
};

exports.getUserEnrollments = async function getUserEnrollments(req, res) {
  const { userId } = req.params;
  try {
    const rows = await db.query(`
      SELECT c.* FROM courses c
      JOIN course_enrollments e ON c.id = e.course_id
      WHERE e.student_id = ?
    `, [userId]);

      console.log("STUDENT ENROLLMENTS:",rows);
    if (!rows) {
      console.error(`⚠️ No enrollment data found for user ${userId}`);
      return res.status(200).json([]); // return empty array if nothing
    }

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching enrollments:", err.message);
    res.status(500).json({ error: "Error fetching enrolled classes" });
  }
};

exports.enrollByCode = async function enrollByCode(req, res) {
  const { userId, code } = req.body;

  console.log("📨 enrollByCode called with", { userId, code });

  try {
    const result = await db.query(`SELECT * FROM courses WHERE code = ?`, [code]);
    console.log("✅ DB query result:", result);
    
      if (!result || result.length == 0) {
      console.warn(`⚠️ No course found with code "${code}"`);
      return res.status(404).json({ error: "Course not found" });
    }

    const course = result[0];
    console.log("✅ course object:", course);

    if (!course || !course.id) {
      console.error("🚨 Course object is invalid or missing ID:", course);
      return res.status(500).json({ error: "Internal course structure error" });
    }

    const courseId = course.id;
    console.log("✅ courseId extracted:", courseId);

    const [existing] = await db.query(
      `SELECT * FROM course_enrollments WHERE student_id = ? AND course_id = ?`,
      [userId, courseId]
    );
      console.log("enrollments!!:",existing);
    if (existing) {
      return res.status(400).json({ error: "Already enrolled" });
    }

    await db.query(
      `INSERT INTO course_enrollments (student_id, course_id) VALUES (?, ?)`,
      [userId, courseId]
    );

    res.json({ success: true, newCourse: course });

  } catch (err) {
    console.error("❌ Enrollment error (outer catch):", err.message);
    res.status(500).json({ error: "Enrollment failed" });
  }
};


exports.getClassById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM pogil_classes WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching class:", err);
    res.status(500).json({ error: 'Database error' });
  }
};
