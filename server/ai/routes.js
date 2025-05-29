// routes/ai.js
const express = require('express');
const router = express.Router();
const { evaluateStudentResponse } = require('./controller');

router.post('/evaluate-response', evaluateStudentResponse);

module.exports = router;
