const express = require('express');
const { requireUserAuth } = require('../middleware/auth');
const { requireAuth } = require('../middleware/auth');
const { reservationStatus, issueCode, showCode, redeemCode, adminDashboard } = require('../controllers/benefits.controller');

const router = express.Router();
router.get('/api/benefits/admin/dashboard', requireAuth, adminDashboard);
const security=require('../middleware/security-rate-limit');
router.get('/api/benefits/:experienceId/reservation', requireUserAuth, reservationStatus);
router.post('/api/benefits/:experienceId/code',requireUserAuth,security.limit('benefit-code-minute',20,60,security.user),security.limit('benefit-code-day',300,86400,security.user),issueCode);
router.post('/api/benefits/:token/redeem', redeemCode);
router.get('/benefit/:token', showCode);

module.exports = router;
