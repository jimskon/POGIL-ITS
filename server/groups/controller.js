const db = require('../db');

// POST /api/groups
exports.assignRoles = async (req, res) => {
  const {
    activity_instance_id,
    facilitator_id,
    spokesperson_id,
    analyst_id,
    qc_id,
    facilitator_email,
    spokesperson_email,
    analyst_email,
    qc_email
  } = req.body;

  try {
    // 🔍 Check if group already exists
    const [[existing]] = await db.query(
      `SELECT id FROM activity_groups WHERE activity_instance_id = ?`,
      [activity_instance_id]
    );

    if (existing) {
      return res.status(400).json({ error: 'Roles have already been assigned to this activity instance.' });
    }

    await db.query(
      `INSERT INTO activity_groups (
        activity_instance_id,
        facilitator_name, facilitator_email,
        spokesperson_name, spokesperson_email,
        analyst_name, analyst_email,
        qc_name, qc_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        activity_instance_id,
        facilitator_id, facilitator_email,
        spokesperson_id, spokesperson_email,
        analyst_id, analyst_email,
        qc_id, qc_email
      ]
    );

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("❌ Error assigning roles:", err);
    res.status(500).json({ error: 'Failed to assign roles' });
  }
};



// GET /api/activity-instances/:id/group
/*exports.getGroupByInstance = async (req, res) => {
  const { id } = req.params;

  try {
    const [[group]] = await db.query(
      `SELECT * FROM activity_groups WHERE activity_instance_id = ?`,
      [id]
    );

    const [[course]] = await db.query(
      `SELECT c.instructor_id
       FROM activity_instances ai
       JOIN courses c ON ai.course_id = c.id
       WHERE ai.id = ?`,
      [id]
    );

    if (!group) {
      return res.json({ rolesAssigned: false, instructor_id: course?.instructor_id || null });
    }

    res.json({
      rolesAssigned: true,
      roles: {
        facilitator: group.facilitator_email,
        spokesperson: group.spokesperson_email,
        analyst: group.analyst_email,
        qc: group.qc_email
      },
      instructor_id: course?.instructor_id || null
    });
  } catch (err) {
    console.error("❌ Error fetching group:", err);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
};
*/
// POST /api/activity-instances/:id/setup-groups
exports.setupGroups = async (req, res) => {
  const { activity_id, course_id, groups } = req.body;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 🔄 Delete old activity_instances and their members
    const [oldInstances] = await conn.query(
      `SELECT id FROM activity_instances WHERE course_id = ? AND activity_id = ?`,
      [course_id, activity_id]
    );
    const instanceIds = oldInstances.map(r => r.id);
    if (instanceIds.length > 0) {
      await conn.query(`DELETE FROM group_members WHERE activity_instance_id IN (?)`, [instanceIds]);
      await conn.query(`DELETE FROM activity_instances WHERE id IN (?)`, [instanceIds]);
    }

    // ➕ Create new activity_instances (one per group)
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const group_number = i + 1;

      const [instanceResult] = await conn.query(
        `INSERT INTO activity_instances (course_id, activity_id, status, group_number)
         VALUES (?, ?, ?, ?)`,
        [course_id, activity_id, 'in_progress', group_number]
      );
      const instanceId = instanceResult.insertId;

      for (let member of group.members) {
        await conn.query(
          `INSERT INTO group_members (activity_instance_id, student_id, role)
           VALUES (?, ?, ?)`,
          [instanceId, member.studentId, member.role]
        );
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ Error setting up groups:", err);
    res.status(500).json({ error: 'Failed to setup groups' });
  } finally {
    conn.release();
  }
};


// GET /api/activity-instances/:id/setup-groups
exports.getSetupGroups = async (req, res) => {
  const activityInstanceId = req.params.id;
console.log("🔍 getSetupGroups called for activityInstanceId:", req.params.id);

  try {
    // Get course_id from activity_instances
    const [[instance]] = await db.query(
      `SELECT course_id FROM activity_instances WHERE id = ?`,
      [activityInstanceId]
    );

    if (!instance) {
      return res.status(404).json({ error: 'Activity instance not found' });
    }

    // Now get enrolled students
    const [students] = await db.query(
      `SELECT users.id, users.name
       FROM users
       JOIN course_enrollments ON users.id = course_enrollments.student_id
       WHERE course_enrollments.course_id = ?`,
      [instance.course_id]
    );
console.log("📦 course_id from activity_instances:", instance.course_id);
console.log("👥 students fetched:", students);

    res.json({ students });
  } catch (err) {
    console.error("❌ Error fetching students for setup groups:", err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/groups/instance/:id
// GET /api/groups/instance/:id
exports.getGroupsByInstance = async (req, res) => {
  const { id: instanceId } = req.params;

  try {
    // Fetch group member details for this activity instance
    const [rows] = await db.query(`
      SELECT
        gm.student_id,
        gm.role,
        u.name AS student_name,
        u.email AS student_email,
        ai.group_number
      FROM group_members gm
      JOIN users u ON gm.student_id = u.id
      JOIN activity_instances ai ON gm.activity_instance_id = ai.id
      WHERE gm.activity_instance_id = ?
      ORDER BY gm.role
    `, [instanceId]);

    if (!rows.length) {
      return res.json({ groups: [] });
    }

    // Since one instance = one group, structure it accordingly
    const group = {
      group_number: rows[0].group_number,
      members: rows.map(row => ({
        student_id: row.student_id,
        name: row.student_name,
        email: row.student_email,
        role: row.role
      }))
    };

    res.json({ groups: [group] });

  } catch (err) {
    console.error("❌ Failed to fetch group members:", err);
    res.status(500).json({ error: "Failed to fetch group members" });
  }
};


