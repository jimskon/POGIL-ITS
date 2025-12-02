// /courses/controller.js
const db = require("../db");

// GET all courses
async function getAllCourses(req, res) {
  const user = req.user;
  const userId = user?.id;
  const role = user?.role;

  try {
    let coursesQuery = `
      SELECT DISTINCT c.*, pc.name AS class_name, u.name AS instructor_name
      FROM courses c
      LEFT JOIN pogil_classes pc ON c.class_id = pc.id
      LEFT JOIN users u ON c.instructor_id = u.id
      LEFT JOIN course_enrollments ce ON c.id = ce.course_id
    `;

    let whereClause = '';
    let params = [];

    if (role !== 'root') {
      whereClause = `
        WHERE c.instructor_id = ? OR ce.student_id = ?
      `;
      params = [userId, userId];
    }

    const [courses] = await db.query(`${coursesQuery} ${whereClause} ORDER BY year DESC, semester ASC`, params);
    res.json(courses.map(course => ({ ...course })));

  } catch (err) {
    console.error("Error fetching courses:", err);
    res.status(500).json({ error: "Database error" });
  }
}

// POST create a new course
async function createCourse(req, res) {
  const { name, code, section, semester, year, instructor_id, class_id } =
    req.body;

  const conn = await db.getConnection(); // get manual connection so we can use transaction

  try {
    await conn.beginTransaction();

    // 1. Create the course
    const [result] = await conn.query(
      `INSERT INTO courses
       (name, code, section, semester, year, instructor_id, class_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, code, section, semester, year, instructor_id, class_id || null]
    );

    const courseId = result.insertId;

    // 2. Auto-enroll the instructor in the new course
    await conn.query(
      `INSERT INTO course_enrollments (student_id, course_id) VALUES (?, ?)`,
      [instructor_id, courseId]
    );

    await conn.commit();

    res.status(201).json({ success: true, courseId });
  } catch (err) {
    await conn.rollback();
    console.error(
      "❌ Error creating course or enrolling instructor:",
      err.message
    );
    res.status(500).json({ error: "Failed to create course" });
  } finally {
    conn.release();
  }
}

async function getCourseEnrollments(req, res) {
  const { courseId } = req.params;
  const userId = req.user?.id; // Add this line
  try {
    const [rows] = await db.query(
      `SELECT 
         c.id, c.name, c.code, c.section, c.semester, c.year,
         u.name AS instructor_name
       FROM course_enrollments ce
       JOIN courses c ON ce.course_id = c.id
       LEFT JOIN users u ON c.instructor_id = u.id
       WHERE ce.student_id = ?`,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to get enrollments:", err);
    res.status(500).json({ error: "Failed to retrieve enrollments" });
  }
}

// DELETE a course
async function deleteCourse(req, res) {
  const user = req.user;
  const courseId = req.params.id;

  try {
    // Step 1: Get the course's instructor ID
    const [result] = await db.query(
      "SELECT instructor_id FROM courses WHERE id = ?",
      [courseId]
    );

    if (result.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    const course = result[0];

    // Step 2: Check if user is allowed to delete
    const isOwner = user.id === course.instructor_id;
    const isAdmin = user.role === "root" || user.role === "creator";

    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete this course" });
    }

    // Step 3: Proceed to delete
    await db.query("DELETE FROM courses WHERE id = ?", [courseId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting course:", err);
    res.status(500).json({ error: "Delete failed" });
  }
}

// GET activities for a course, with student instance info
// GET activities for a course, returning one row per activity_instance (i.e. per group)
async function getCourseActivities(req, res) {
  const { courseId } = req.params;
  const userId = req.user?.id;

  console.log(
    "🔍 getCourseActivities for course:",
    courseId,
    "and user:",
    userId
  );

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const [rows] = await db.query(
      `SELECT 
         a.id AS activity_id,
         a.name AS activity_name,
         a.order_index AS activity_index,
         (
           SELECT ai2.id
           FROM activity_instances ai2
           JOIN group_members gm ON gm.activity_instance_id = ai2.id
           WHERE ai2.activity_id = a.id AND ai2.course_id = c.id AND gm.student_id = ?
           LIMIT 1
         ) AS instance_id,
         COUNT(ai.id) AS group_count,
         MAX(ai.status = 'in_progress') AS is_ready
       FROM pogil_activities a
       JOIN courses c ON a.class_id = c.class_id
       LEFT JOIN activity_instances ai
         ON ai.activity_id = a.id AND ai.course_id = c.id
       WHERE c.id = ?
       GROUP BY a.id, a.name, a.order_index
       ORDER BY a.order_index ASC`,
      [userId, courseId]
    );

    const activities = rows.map((row) => ({
      activity_id: row.activity_id,
      title: row.activity_name,
      order_index: row.activity_index,
      instance_id: row.instance_id || null, // specific to the logged-in student
      is_ready: !!row.is_ready,
      has_groups: row.group_count > 0,
    }));
    //console.log("📘 Fetched activities for course:", courseId, "Activities:", activities);
    res.json(activities);
  } catch (err) {
    console.error("❌ Error fetching activities for course:", err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
}

// GET all courses a user is enrolled in
async function getUserEnrollments(req, res) {
  const { userId } = req.params;
  //console.log("getUserEnrollments", userId);

  try {
    const [rows] = await db.query(
      `SELECT 
     c.id, c.name, c.code, c.section, c.semester, c.year,
     c.instructor_id,
     u.name AS instructor_name,
     pc.name AS class_name
   FROM course_enrollments ce
   JOIN courses c ON ce.course_id = c.id
   LEFT JOIN users u ON c.instructor_id = u.id
   LEFT JOIN pogil_classes pc ON c.class_id = pc.id
   WHERE ce.student_id = ?`,
      [userId]
    );
    //console.log("getUserEnrollments:", rows);

    res.json(rows.map(r => ({ ...r }))); // ✅ Flatten enrollment rows
  } catch (err) {
    console.error("Error fetching enrolled courses:", err);
    res.status(500).json({ error: "Failed to load enrolled courses" });
  }
}

// POST enroll in a course by course code
async function enrollByCode(req, res) {
  const { userId, code } = req.body;
  console.log("enrollByCode:", userId, code);

  try {
    const [courses] = await db.query(`SELECT * FROM courses WHERE code = ?`, [
      code,
    ]);
    console.log("Courses:", courses);

    if (!Array.isArray(courses) || courses.length === 0) {
      return res.status(404).json({ error: "Course code not found" });
    }

    const course = { ...courses[0] }; // ✅ Flatten single course immediately

    const [enrollments] = await db.query(
      `SELECT * FROM course_enrollments WHERE student_id = ? AND course_id = ?`,
      [userId, course.id]
    );
    console.log("Enrollments:", enrollments);

    if (enrollments.length > 0) {
      return res.status(400).json({ error: "Already enrolled in this course" });
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
        year: course.year,
      },
    });
  } catch (err) {
    console.error("Error enrolling in course:", err);
    res.status(500).json({ error: "Failed to enroll" });
  }
}

async function getStudentsForCourse(req, res) {
  const { courseId } = req.params;

  try {
    const [students] = await db.query(
      `SELECT u.id, u.name, u.email, u.role
   FROM course_enrollments ce
   JOIN users u ON ce.student_id = u.id
   WHERE ce.course_id = ?`,
      [courseId]
    );

    res.json(students);
  } catch (err) {
    console.error("❌ Failed to fetch students for course:", err);
    res.status(500).json({ error: "Failed to fetch students" });
  }
}

async function unenrollStudentFromCourse(req, res) {
  const { courseId, studentId } = req.params;
  const user = req.user;

  // Check permissions
  const [result] = await db.query(
    `SELECT instructor_id FROM courses WHERE id = ?`,
    [courseId]
  );

  if (!result.length) {
    return res.status(404).json({ error: "Course not found" });
  }

  const course = result[0];
  const isOwner = user.id === course.instructor_id;
  const isAdmin = user.role === 'root' || user.role === 'creator';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  // Remove enrollment
  await db.query(
    `DELETE FROM course_enrollments WHERE student_id = ? AND course_id = ?`,
    [studentId, courseId]
  );

  res.json({ success: true });
}

async function getCourseInfo(req, res) {
  const { courseId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT id, name, code, section, semester, year, instructor_id
       FROM courses
       WHERE id = ?`,
      [courseId]
    );
    console.log("getCourseInfo for courseId:", courseId, "Result:", rows);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error fetching course info:", err);
    res.status(500).json({ error: "Failed to get course info" });
  }
}

async function getCourseProgress(req, res) {
  const { courseId } = req.params;

  try {
    // 1) Get enrolled students
    const [students] = await db.query(
      `SELECT u.id, u.name, u.email
       FROM course_enrollments ce
       JOIN users u ON ce.student_id = u.id
       WHERE ce.course_id = ?`,
      [courseId]
    );

    // 2) Get all activities for the course (via class_id), include is_test flag
    const [activities] = await db.query(
      `SELECT id, name, COALESCE(is_test, 0) AS is_test
       FROM pogil_activities
       WHERE class_id = (
         SELECT class_id FROM courses WHERE id = ?
       )
       ORDER BY order_index`,
      [courseId]
    );

    // 3) Pull instances + group membership + responses for this course
    const [rows] = await db.query(
      `
      SELECT
        ai.id            AS instance_id,
        ai.activity_id   AS activity_id,
        ai.total_groups  AS total_groups,
        a.is_test        AS is_test,
        gm.student_id    AS student_id,
        r.question_id    AS question_id,
        r.response       AS response
      FROM activity_instances ai
      JOIN pogil_activities a ON a.id = ai.activity_id
      JOIN group_members gm   ON gm.activity_instance_id = ai.id
      LEFT JOIN responses r   ON r.activity_instance_id = ai.id
      WHERE ai.course_id = ?
      `,
      [courseId]
    );

    // 4) Initialize per-student structure
    const progressByStudent = new Map();
    for (const s of students) {
      progressByStudent.set(s.id, {
        id: s.id,
        name: s.name,
        email: s.email,
        completeCount: 0,
        partialCount: 0,
        // activityId -> { status, isTest, completedGroups, totalGroups, pointsEarned, pointsPossible }
        progress: {}
      });
    }

    const ensureStudentActivity = (studentId, activityId, isTest, totalGroups) => {
      const student = progressByStudent.get(studentId);
      if (!student) return null;

      if (!student.progress[activityId]) {
        student.progress[activityId] = {
          status: 'not_started',
          isTest: !!isTest,
          completedGroups: 0,
          totalGroups: totalGroups || 0,
          pointsEarned: 0,
          pointsPossible: 0
        };
      } else {
        // If we didn't know totalGroups yet, fill it in from this instance
        if (!student.progress[activityId].totalGroups && totalGroups) {
          student.progress[activityId].totalGroups = totalGroups;
        }
      }
      return student.progress[activityId];
    };

    // 5) Aggregate group-state + test scores from responses
    for (const row of rows) {
      const {
        student_id,
        activity_id,
        is_test,
        total_groups,
        question_id,
        response,
      } = row;

      const prog = ensureStudentActivity(
        student_id,
        activity_id,
        is_test,
        total_groups
      );
      if (!prog || !question_id || response == null) continue;

      // For non-test activities: group completion markers like "1state", "2state", ...
      const groupStateMatch = question_id.match(/^(\d+)state$/);
      if (groupStateMatch) {
        if (response === 'completed') {
          prog.completedGroups += 1;
        }
        continue;
      }

      // For tests: store overall totals written by submitTest()
      if (question_id === 'testTotalScore') {
        const pts = Number(response) || 0;
        prog.pointsEarned = Math.max(prog.pointsEarned, pts);
        continue;
      }
      if (question_id === 'testMaxScore') {
        const pts = Number(response) || 0;
        prog.pointsPossible = Math.max(prog.pointsPossible, pts);
        continue;
      }
    }

    // 6) Derive status + complete/partial counters per student & activity
    //    We also make sure every activity appears for every student.
    for (const student of progressByStudent.values()) {
      for (const a of activities) {
        const actId = a.id;
        const isTest = !!a.is_test;
        const prog = student.progress[actId];

        if (!prog) {
          // default slot for not-started activity
          student.progress[actId] = {
            status: 'not_started',
            isTest,
            completedGroups: 0,
            totalGroups: 0,
            pointsEarned: 0,
            pointsPossible: 0
          };
          continue;
        }

        prog.isTest = isTest;

        if (isTest) {
          if (prog.pointsPossible > 0) {
            // If the test was graded at all, treat it as "completed"
            prog.status = 'completed';
            student.completeCount += 1;
          } else {
            prog.status = 'not_started';
          }
        } else {
          const tg = prog.totalGroups || 0;
          const cg = prog.completedGroups || 0;

          if (tg > 0 && cg >= tg) {
            prog.status = 'completed';
            student.completeCount += 1;
          } else if (cg > 0) {
            prog.status = 'in_progress';
            student.partialCount += 1;
          } else {
            prog.status = 'not_started';
          }
        }
      }
    }

    // 7) Shape response
    res.json({
      activities: activities.map(a => ({
        id: a.id,
        name: a.name,
        isTest: !!a.is_test
      })),
      students: Array.from(progressByStudent.values()),
    });
  } catch (err) {
    console.error("❌ Failed to load progress:", err);
    res.status(500).json({ error: "Failed to get student progress" });
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
  getStudentsForCourse,
  unenrollStudentFromCourse,
  getCourseInfo,
  getCourseProgress    // ← this must be listed
};