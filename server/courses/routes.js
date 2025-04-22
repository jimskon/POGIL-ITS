const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Get all courses
router.get('/', controller.getAllCourses);

// Create a new course
router.post('/', controller.createCourse);

// Delete a course by ID
router.delete('/:id', controller.deleteCourse);

module.exports = router;
