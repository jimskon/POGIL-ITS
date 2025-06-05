// routes/ai.js
const express = require('express');
const router = express.Router();
const {
    evaluateStudentResponse,
    evaluatePythonCode, // ✅ Import new function
} = require('./controller');

// Existing short answer evaluation
router.post('/evaluate-response', evaluateStudentResponse);

// ✅ New: Python code evaluation route
router.post('/evaluate-code', evaluatePythonCode);

module.exports = router;

