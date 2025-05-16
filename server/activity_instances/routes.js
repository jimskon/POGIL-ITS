const express = require('express');
const router = express.Router();
const controller = require('./controller');

console.log("✅ Registering activity_instances routes");

// ✅ Create a new activity instance
router.post('/', controller.createActivityInstance);

// ✅ Get details of an activity instance
router.get('/:id', controller.getActivityInstanceById);

// ✅ Parse and fetch the activity sheet content
router.get('/:instanceId/preview-doc', controller.getParsedActivityDoc);

// ✅ Group setup: assign students into groups
router.post('/:id/setup-groups', controller.setupGroupsForInstance);

// ✅ Get all enrolled students in the course for this activity instance
router.get('/:id/enrolled-students', controller.getEnrolledStudents);

// ✅ Heartbeat tracking to monitor presence
router.post('/:instanceId/heartbeat', controller.recordHeartbeat);

// ✅ Get the current active student in a group (or auto-assign)
router.get('/:instanceId/active-student', controller.getActiveStudent);

// ✅ Rotate to next active student
router.post('/:instanceId/rotate-active-student', controller.rotateActiveStudent);

// ✅ Submit group responses
router.post('/:instanceId/submit-group', controller.submitGroupResponses);

// ✅ Get all responses for a specific group in an activity instance
router.get('/:instanceId/group/:groupId/responses', controller.getGroupResponses);

// ✅ Get all groups and their members for an instance
router.get('/:instanceId/groups', controller.getInstanceGroups);

// ✅ New: Create one activity instance per group
router.post('/setup-groups', controller.setupMultipleGroupInstances);

module.exports = router;
