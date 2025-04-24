const express = require('express');
const router = express.Router();
const controller = require('./controller');
const { google } = require('googleapis');
const { authorize } = require('../utils/googleAuth');

// ==========================
// Activity CRUD Endpoints
// ==========================

// GET /activities
router.get('/', controller.getAllActivities);

// POST /activities
router.post('/', controller.createActivity);


// ==========================
// Google Sheets Preview
// ==========================

// GET /activities/preview?sheetUrl=...
router.get('/preview', async (req, res) => {
  const { sheetUrl } = req.query;
  try {
    const auth = await authorize();
    const sheets = google.sheets({ version: 'v4', auth });

    const sheetId = new URL(sheetUrl).pathname.split('/')[3];
    const range = 'Sheet1'; // or auto-detect

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    res.json({ data: result.data.values });
  } catch (err) {
    console.error("Error fetching sheet data:", err);
    res.status(500).send('Error fetching sheet data');
  }
});

// ==========================
// Google Docs Preview
// ==========================

// GET /activities/preview-doc?docUrl=...
router.get('/preview-doc', async (req, res) => {
  const { docUrl } = req.query;
  //console.log("Previewing doc:", docUrl);
  try {
    const auth = await authorize();
    const docs = google.docs({ version: 'v1', auth });

    const docId = new URL(docUrl).pathname.split('/')[3];
    const doc = await docs.documents.get({ documentId: docId });

    const lines = doc.data.body.content
      .flatMap(item => item.paragraph?.elements || [])
      .map(e => e.textRun?.content?.replace(/\r?\n$/, ''))  
      .filter(Boolean);

    res.json({ lines });
  } catch (err) {
    console.error("Google Doc read error:", err);
    res.status(500).send("Failed to read Google Doc");
  }
});

// DELETE /activities/:name
router.delete('/:name', controller.deleteActivity);

router.get('/check-access', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({ access: true });

  try {
    const auth = await authorize();
    const docId = new URL(url).pathname.split('/')[3];
    const docs = google.docs({ version: 'v1', auth });
    await docs.documents.get({ documentId: docId });
    res.json({ access: true });
  } catch (err) {
    console.error("Access check failed:", err.message);
    res.json({ access: false });
  }
});

// GET /activities/:name
router.get('/:name', controller.getActivity);

// POST /activities/:name/launch
router.post('/:name/launch', controller.launchActivityInstance);



module.exports = router;
