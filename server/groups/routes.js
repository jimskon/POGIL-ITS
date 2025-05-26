const express = require('express');
const router = express.Router();
const controller = require('./controller');

// Get the group assigned to a given activity instance (one group = one instance)
router.get('/instance/:id', controller.getGroupsByInstance);

module.exports = router;
