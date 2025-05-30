const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Get all students enrolled in a course (used for role selection)
router.get('/:courseId/enrollments', controller.getCourseEnrollments);

// Get activities for a course
router.get('/:courseId/activities', controller.getCourseActivities);

// Get user's enrolled courses
router.get('/user/:userId/enrollments', controller.getUserEnrollments);

// Enroll in course by code
router.post('/enroll-by-code', controller.enrollByCode);

// Get all courses
router.get('/', controller.getAllCourses);

// Create a new course
router.post('/', controller.createCourse);

// Delete a course
router.delete('/:id', controller.deleteCourse);

router.get('/:courseId/students', controller.getStudentsForCourse);


module.exports = router;
