const db = require('../db');

exports.createActivity = async (req, res) => {
  const { name, title, googleSheetUrl, createdBy } = req.body;
  try {
    await db.query(
      'INSERT INTO pogol_activities (name, title, google_sheet_url, created_by) VALUES (?, ?, ?, ?)',
      [name, title, googleSheetUrl, createdBy]
    );
    res.status(201).json({ message: 'Activity created.' });
  } catch (err) {
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
