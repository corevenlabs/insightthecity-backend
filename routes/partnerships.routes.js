const express = require('express');
const { getFeatured, updateFeatured } = require('../controllers/partnerships.controller');
const requireAuth = require('../middleware/staff').requireStaff('admin','editor');

const router = express.Router();

// El panel manda su sesión para ver y editar la alianza aunque no esté publicada; la app no.
const staffIfPresent = (req, res, next) => (req.headers.authorization ? requireAuth(req, res, next) : next());
router.get('/featured', staffIfPresent, getFeatured);
router.put('/featured', requireAuth, updateFeatured);

module.exports = router;
