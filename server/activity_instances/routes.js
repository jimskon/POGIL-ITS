//activity_instances/routes.js
const express = require('express');
const router = express.Router();
const controller = require('./controller');
console.log("✅ Registering activity_instances routes");
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
router.get('/:instanceId/group/:groupId/active-student', controller.getActiveStudent);
router.get('/:instanceId/active-student', controller.getActiveStudent);
router.post('/:instanceId/rotate-active-student', controller.rotateActiveStudent);

// Activity preview doc (parsed)
router.get('/:instanceId/preview-doc', controller.getParsedActivityDoc);

// Activity instance data submit
router.post('/:instanceId/submit-group', controller.submitGroup);

// Activity instance data retrieval
router.get('/:instanceId/group/:groupId/responses', controller.getGroupResponses);

// Activity instance data retrieval by question
router.get('/responses/:instanceId/:groupId', controller.getGroupResponses);


module.exports = router;
