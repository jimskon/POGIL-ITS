const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Create new activity instance
router.post('/', controller.createActivityInstance);

// Get instance details
router.get('/:id', controller.getActivityInstanceById);

// Group setup and enrollment
router.post('/:id/setup-groups', controller.setupGroupsForInstance);
router.get('/:id/setup-groups', controller.getEnrolledStudents);
router.get('/:id/enrolled-students', controller.getEnrolledStudents);

// Heartbeat tracking
router.post('/:instanceId/heartbeat', controller.recordHeartbeat);

// Active student access and rotation
router.get('/:instanceId/active-student', controller.getActiveStudent);
router.get('/:instanceId/group/:groupId/active-student', controller.getActiveStudent);
router.post('/:instanceId/active-student', controller.setActiveStudent);
router.post('/:instanceId/rotate-active-student', controller.rotateActiveStudent);

// Activity preview doc (parsed)
router.get('/:instanceId/preview-doc', controller.getParsedActivityDoc);

module.exports = router;
