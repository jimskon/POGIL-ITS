const db = require('../db');

exports.createActivity = async (req, res) => {
  const { name, title, sheet_url, createdBy } = req.body;
  console.log("Add activity: ",req.body);
  if (!name || !title || !sheet_url) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  console.log("Add activity: ",name,title,sheet_url);
  try {
    await db.query(
      'INSERT INTO pogol_activities (name, title, sheet_url, created_by) VALUES (?, ?, ?, ?)',
      [name, title, sheet_url, createdBy]
    );
    res.status(201).json({ message: 'Activity created.' });
  } catch (err) {
    console.error('Create activity error:', err);
    res.status(500).json({ error: 'Error creating activity.' });
  }
};

exports.getActivity = async (req, res) => {
  const { name } = req.params;
  try {
    const [activity] = await db.query('SELECT * FROM pogol_activities WHERE name = ?', [name]);
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: 'Could not retrieve activity.' });
  }
};

exports.launchActivityInstance = async (req, res) => {
  const { courseId, groupNumber } = req.body;
  try {
    await db.query(
      'INSERT INTO activity_instances (activity_name, course_id, start_time, group_number) VALUES (?, ?, NOW(), ?)',
      [req.params.name, courseId, groupNumber]
    );
    res.status(201).json({ message: 'Activity instance launched.' });
  } catch (err) {
    res.status(500).json({ error: 'Launch failed.' });
  }
};


exports.getAllActivities = async (req, res) => {
  try {
    const activities = await db.query('SELECT * FROM pogol_activities');
    res.json(activities); // make sure this is a plain array
  } catch (err) {
    console.error('Error fetching activities:', err);
    res.status(500).json({ error: 'Could not retrieve activities.' });
  }
};

exports.deleteActivity = async (req, res) => {
  const { name } = req.params;
  console.log("Deleting activity:", name);
  try {
    await db.query('DELETE FROM pogol_activities WHERE name = ?', [name]);
    res.json({ message: 'Activity deleted.' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete activity.' });
  }
};
