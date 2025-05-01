const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Assign roles for an activity instance
router.post('/', controller.assignRoles);

// Get role info for an activity instance
router.get('/instance/:id', controller.getGroupByInstance);

router.post('/activity-instances/:id/setup-groups', controller.setupGroups);

module.exports = router;

