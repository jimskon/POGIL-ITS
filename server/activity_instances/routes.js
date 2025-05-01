const express = require('express');
const router = express.Router();
const controller = require('./controller');

// POST /activity-instances
router.post('/', controller.createActivityInstance);

// Get activity instance details by ID
router.get('/:id', controller.getActivityInstanceById);

router.post('/:id/setup-groups', controller.setupGroupsForInstance);

router.get('/:id/setup-groups', controller.getEnrolledStudents);

router.get('/:id/enrolled-students', controller.getEnrolledStudents);

router.post('/:instanceId/heartbeat', controller.recordHeartbeat)

router.get('/:instanceId/group/:groupId/active-student', controller.getActiveStudent);

router.get('/:instanceId/active-student', controller.getActiveStudent);

router.get('/:instanceId/preview-doc', controller.getParsedActivityDoc);

module.exports = router;
