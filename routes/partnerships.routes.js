const express = require('express');
const { getFeatured, updateFeatured } = require('../controllers/partnerships.controller');
const requireAuth = require('../middleware/staff').requireStaff('admin','editor');

const router = express.Router();

router.get('/featured', getFeatured);
router.put('/featured', requireAuth, updateFeatured);

module.exports = router;
