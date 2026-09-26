const express = require('express');
const { requireUserAuth } = require('../middleware/auth');
const { issueCode, showCode, redeemCode } = require('../controllers/benefits.controller');

const router = express.Router();
router.post('/api/benefits/:experienceId/code', requireUserAuth, issueCode);
router.post('/api/benefits/:token/redeem', redeemCode);
router.get('/benefit/:token', showCode);

module.exports = router;
