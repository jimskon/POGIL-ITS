// /courses/controller.js
const db = require('../db');

// GET all courses
async function getAllCourses(req, res) {
  try {
    const [courses] = await db.query(
      `SELECT 
         c.*, 
         u.name AS instructor_name, 
         pc.name AS class_name
       FROM courses c
       LEFT JOIN users u ON c.instructor_id = u.id
       LEFT JOIN pogil_classes pc ON c.class_id = pc.id
       ORDER BY year DESC, semester ASC`
    );
    console.log("getAllCourses", courses);
    
    res.json(courses.map(course => ({ ...course }))); // ✅ Flatten RowDataPacket
  } catch (err) {
    console.error('Error fetching courses:', err);
    res.status(500).json({ error: 'Database error' });
  }
}

// POST create a new course
async function createCourse(req, res) {
  const { name, code, section, semester, year, instructor_id, class_id } = req.body;

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

async function getCourseEnrollments(req, res) {
  const { courseId } = req.params;
  try {
    const [rows] = await db.query(`
      SELECT u.id, u.name, u.email
      FROM course_enrollments ce
      JOIN users u ON ce.student_id = u.id
      WHERE ce.course_id = ?
    `, [courseId]);
    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to get enrollments:", err);
    res.status(500).json({ error: "Failed to retrieve enrollments" });
  }
}

// DELETE a course
async function deleteCourse(req, res) {
  try {
    await db.query('DELETE FROM courses WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting course:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
}

// GET activities for a course, with student instance info
// GET activities for a course, returning one row per activity_instance (i.e. per group)
async function getCourseActivities(req, res) {
  const { courseId } = req.params;
  console.log("🔍 getCourseActivities courseId param:", courseId);

  try {
    const [rows] = await db.query(
      `SELECT 
         a.id AS activity_id,
         a.name AS activity_name,
         a.order_index AS activity_index,
         MIN(ai.id) AS instance_id,  -- any one instance ID, to check if one exists
         COUNT(ai.id) AS group_count,
         MAX(ai.status = 'in_progress') AS is_ready
       FROM pogil_activities a
       JOIN courses c ON a.class_id = c.class_id
       LEFT JOIN activity_instances ai
         ON ai.activity_id = a.id AND ai.course_id = c.id
       WHERE c.id = ?
       GROUP BY a.id
       ORDER BY a.order_index ASC`,
      [courseId]
    );
    console.log("🧪 getCourseActivities result:", rows);

    const activities = rows.map(row => ({
      activity_id: row.activity_id,
      title: row.activity_name,
      order_index: row.activity_index,
      instance_id: row.instance_id || null,
      is_ready: !!row.is_ready,
      has_groups: row.group_count > 0
    }));

    res.json(activities);
  } catch (err) {
    console.error("❌ Error fetching activities for course:", err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
}



// GET all courses a user is enrolled in
async function getUserEnrollments(req, res) {
  const { userId } = req.params;
  console.log("getUserEnrollments", userId);

  try {
    const [rows] = await db.query(
      `SELECT c.id, c.name, c.code, c.section, c.semester, c.year, u.name AS instructor_name
       FROM course_enrollments ce
       JOIN courses c ON ce.course_id = c.id
       LEFT JOIN users u ON c.instructor_id = u.id
       WHERE ce.student_id = ?`,
      [userId]
    );
    console.log("getUserEnrollments:", rows);
    
    res.json(rows.map(r => ({ ...r }))); // ✅ Flatten enrollment rows
  } catch (err) {
    console.error('Error fetching enrolled courses:', err);
    res.status(500).json({ error: 'Failed to load enrolled courses' });
  }
}

// POST enroll in a course by course code
async function enrollByCode(req, res) {
  const { userId, code } = req.body;
  console.log("enrollByCode:", userId, code);

  try {
    const [courses] = await db.query(
      `SELECT * FROM courses WHERE code = ?`,
      [code]
    );
    console.log("Courses:", courses);

    if (!Array.isArray(courses) || courses.length === 0) {
      return res.status(404).json({ error: 'Course code not found' });
    }

    const course = { ...courses[0] }; // ✅ Flatten single course immediately

    const [enrollments] = await db.query(
      `SELECT * FROM course_enrollments WHERE student_id = ? AND course_id = ?`,
      [userId, course.id]
    );
    console.log("Enrollments:", enrollments);

    if (enrollments.length > 0) {
      return res.status(400).json({ error: 'Already enrolled in this course' });
    }

    // Enroll the user
    await db.query(
      `INSERT INTO course_enrollments (student_id, course_id) VALUES (?, ?)`,
      [userId, course.id]
    );

    res.status(201).json({
      success: true,
      newCourse: {
        id: course.id,
        name: course.name,
        code: course.code,
        section: course.section,
        semester: course.semester,
        year: course.year
      }
    });
  } catch (err) {
    console.error('Error enrolling in course:', err);
    res.status(500).json({ error: 'Failed to enroll' });
  }
}

async function getStudentsForCourse(req, res) {
  const { courseId } = req.params;

  try {
    const [students] = await db.query(
      `SELECT u.id, u.name, u.email
       FROM course_enrollments ce
       JOIN users u ON ce.student_id = u.id
       WHERE ce.course_id = ? AND u.role = 'student'`,
      [courseId]
    );

    res.json(students);
  } catch (err) {
    console.error("❌ Failed to fetch students for course:", err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
}


module.exports = {
  getAllCourses,
  createCourse,
  deleteCourse,
  getCourseActivities,
  getUserEnrollments,
  enrollByCode,
  getCourseEnrollments,
  getStudentsForCourse
};
