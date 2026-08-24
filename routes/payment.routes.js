const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/payment.controller');
const { requireUserAuth } = require('../middleware/auth');

router.post('/create-subscription', requireUserAuth, paymentController.createSubscription);

module.exports = router;
