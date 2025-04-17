const express = require('express');
const router = express.Router();
const controller = require('./controller');

// POST /activities - create a new activity
router.post('/', controller.createActivity);

// GET /activities/:name - fetch activity metadata
router.get('/:name', controller.getActivity);

// POST /activities/:name/launch - create new activity instance
router.post('/:name/launch', controller.launchActivityInstance);

module.exports = router;
