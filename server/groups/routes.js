const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Assign roles for an activity instance
router.post('/', controller.assignRoles);

// Get role info for an activity instance
router.get('/instance/:id', controller.getGroupByInstance);

module.exports = router;

