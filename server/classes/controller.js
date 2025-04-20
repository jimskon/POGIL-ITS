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

  if (!name || !title || !sheet_url || order_index === undefined || createdBy === undefined) {
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

