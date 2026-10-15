const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/payment.controller');
const { requireUserAuth } = require('../middleware/auth');

router.get('/plan', paymentController.getPlan);
router.get('/return', paymentController.returnToApp);
const security=require('../middleware/security-rate-limit');
router.post('/create-subscription', requireUserAuth,security.limit('checkout',10,60,security.user), paymentController.createSubscription);
router.post('/confirm-subscription', requireUserAuth, paymentController.confirmSubscription);
router.post('/portal', requireUserAuth,security.limit('billing-portal',20,60,security.user), paymentController.createPortal);
router.post('/renewal', requireUserAuth, paymentController.changeRenewal);

module.exports = router;
