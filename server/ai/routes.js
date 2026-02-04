// server/ai/routes.js
const express = require('express');
const router = express.Router();
const {
  evaluateStudentResponse,
  evaluatePythonCode,
  evaluateCode,
  gradeTestQuestionHttp,
  evaluateCppCode,
} = require('./controller');

console.log('AI handlers typeof:', {
  evaluateStudentResponse: typeof evaluateStudentResponse,
  evaluatePythonCode: typeof evaluatePythonCode,
  evaluateCode: typeof evaluateCode,
  gradeTestQuestionHttp: typeof gradeTestQuestionHttp,
  evaluateCppCode: typeof evaluateCppCode,
});

// Short-answer / text evaluation
router.post('/evaluate-response', evaluateStudentResponse);

// Python-only (legacy)
router.post('/evaluate-python-code', evaluatePythonCode);

// Generic code (Python/C++/etc.)
router.post('/evaluate-code', async (req, res) => {
  console.error('[AI!!!!!] /api/ai/evaluate-code');
  try {
    const result = await evaluateCode(req.body);
    return res.json(result);
  } catch (err) {
    console.error('❌ /api/ai/evaluate-code failed:', err);
    return res.status(500).json({ feedback: null, followup: null });
  }
});

// C++ wrapper (if you’re using it)
router.post('/evaluate-cpp-code', evaluateCppCode);

// ✅ Test-mode grading – calls into controller.js
router.post('/grade-test-question', gradeTestQuestionHttp);

module.exports = router;
