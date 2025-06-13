const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Get all classes
router.get('/', controller.getAllClasses);

// Create a new class
router.post('/', controller.createClass);

// Update a class
router.put('/:id', controller.updateClass);

// Delete a class
router.delete('/:id', controller.deleteClass);

// ✅ Activities for a class
router.get('/:id/activities', controller.getActivitiesByClass);
router.post('/:id/activities', controller.createActivityForClass);
router.put('/:id/activities/:activityName', controller.updateActivityForClass);
router.delete('/:classId/activities/id/:activityId', controller.deleteActivityFromClass);

// ✅ NEW: Get single class info
router.get('/:id', controller.getClassById);

// Enrollment related
router.get('/user/:userId/enrollments', controller.getUserEnrollments);
router.post('/enroll-by-code', controller.enrollByCode);

module.exports = router;

