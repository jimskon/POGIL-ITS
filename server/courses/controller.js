const db = require('../db');

// GET all courses
async function getAllCourses(req, res) {
  try {
    const courses = await db.query(
	`SELECT c.*, pc.name AS class_name
         FROM courses c
         LEFT JOIN pogil_classes pc ON c.class_id = pc.id
         ORDER BY year DESC, semester ASC`
    );

    // Ensure it's always an array (even if MySQL someday changes behavior)
    if (!Array.isArray(courses)) {
      console.warn("⚠️ Expected an array of courses, got:", courses);
      return res.json([courses]);  // Wrap single object
    }

    res.json(courses); // ✅ Good to go
  } catch (err) {
    console.error('Error fetching courses:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

// POST create a new course
async function createCourse(req, res) {
  const {
    name, code, section, semester, year,
    instructor_id, class_id
  } = req.body;

  try {
    const [result] = await db.query(
      `INSERT INTO courses
       (name, code, section, semester, year, instructor_id, class_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, code, section, semester, year, instructor_id, class_id || null]
    );
    res.status(201).json({ success: true, courseId: result.insertId });
  } catch (err) {
    console.error("❌ Error creating course:", err.message);
    res.status(500).json({ error: "Failed to create course" });
  }
}

// DELETE a course
async function deleteCourse(req, res) {
  try {
    //  console.log("Delete:",req.params);
    await db.query('DELETE FROM courses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting course:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
}

module.exports = {
  getAllCourses,
  createCourse,
  deleteCourse
};
