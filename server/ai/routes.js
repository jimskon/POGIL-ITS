// routes/ai.js
const express = require('express');
const router = express.Router();
const {
  evaluateStudentResponse,
  evaluatePythonCode,
  evaluateCode,
} = require('./controller');

// Short-answer / text evaluation
router.post('/evaluate-response', evaluateStudentResponse);

// (Optional) keep a Python-only endpoint if you still use it somewhere:
router.post('/evaluate-python-code', evaluatePythonCode);

// Generic code evaluation (Python, C++, etc.)
// This is what RunActivityPage should be calling.
router.post('/evaluate-code', async (req, res) => {
  try {
    const result = await evaluateCode(req.body); // evaluateCode returns a plain object
    return res.json(result);
  } catch (err) {
    console.error('❌ /api/ai/evaluate-code failed:', err);
    return res.status(500).json({ feedback: null, followup: null });
  }
});

module.exports = router;
