const express = require('express');
const router = express.Router();
const controller = require('./controller');

// POST /api/responses
router.post('/', controller.createResponse);

router.get('/:instanceId/:groupId', controller.getGroupResponses);

module.exports = router;
