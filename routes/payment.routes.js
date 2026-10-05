const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/payment.controller');
const { requireUserAuth } = require('../middleware/auth');

router.get('/plan', paymentController.getPlan);
router.get('/return', paymentController.returnToApp);
router.post('/create-subscription', requireUserAuth, paymentController.createSubscription);
router.post('/confirm-subscription', requireUserAuth, paymentController.confirmSubscription);
router.post('/portal', requireUserAuth, paymentController.createPortal);
router.post('/renewal', requireUserAuth, paymentController.changeRenewal);

module.exports = router;
