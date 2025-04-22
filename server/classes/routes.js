const express = require('express');
const router = express.Router();
const controller = require('./controller');

router.get('/', controller.getAllClasses);
router.post('/', controller.createClass);
router.put('/:id', controller.updateClass);
router.delete('/:id', controller.deleteClass);
router.get('/:id/activities', controller.getActivitiesByClass);
router.post('/:id/activities', controller.createActivityForClass);
router.put('/:id/activities/:activityName', controller.updateActivityForClass);
router.delete('/:id/activities/:activityName', controller.deleteActivityFromClass);
router.get('/user/:userId/enrollments', controller.getUserEnrollments);
router.post('/enroll-by-code', controller.enrollByCode);


module.exports = router;
