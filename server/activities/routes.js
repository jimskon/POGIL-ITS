const express = require('express');
const router = express.Router();
const controller = require('./controller');

// GET /activities - get them all
router.get('/', controller.getAllActivities); // GET /activities

// POST /activities - create a new activity
router.post('/', controller.createActivity);

// GET /activities/:name - fetch activity metadata
router.get('/:name', controller.getActivity);

// POST /activities/:name/launch - create new activity instance
router.post('/:name/launch', controller.launchActivityInstance);

// Delete
router.delete('/:name', controller.deleteActivity);

module.exports = router;
