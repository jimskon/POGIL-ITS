// server/courses/routes.js
const express = require("express");
const router = express.Router();
const controller = require("./controller");

// Get all students enrolled in a course (used for role selection)
router.get("/:courseId/enrollments", controller.getCourseEnrollments);

// Get activities for a course
router.get("/:courseId/activities", controller.getCourseActivities);

// Get user's enrolled courses
router.get("/user/:userId/enrollments", controller.getUserEnrollments);

// Enroll in course by code
router.post("/enroll-by-code", controller.enrollByCode);

// Get all courses (no custom middleware needed here)
router.get("/", controller.getAllCourses);

// Create a new course
router.post("/", controller.createCourse);

// Delete a course
router.delete("/:id", controller.deleteCourse);

// Get students for a course
router.get("/:courseId/students", controller.getStudentsForCourse);

// Unenroll a student from a course
router.delete("/:courseId/unenroll/:studentId", controller.unenrollStudentFromCourse);

// Get course info (used in ManageCourseStudentsPage)
router.get("/:courseId/info", controller.getCourseInfo);

// Get course progress (used in ManageCoursesPage)
router.get("/:courseId/progress", controller.getCourseProgress);



module.exports = router;
