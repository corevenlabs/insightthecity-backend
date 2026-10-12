const router = require("express").Router();
const Stripe = require("stripe");
router.post("/", async (req, res) => {
  let event;
  try {
    event = new Stripe(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(
      req.body, req.headers["stripe-signature"], process.env.PARTNER_STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return res.status(400).send("Webhook signature error");
  }
  try {
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) &&
        event.data.object.payment_status === "paid") {
      await require("../services/partner-crm.service").confirmPaymentLink(event.data.object);
    }
    res.json({ received: true });
  } catch (err) {
    console.error("[partner payment webhook]", err.message);
    res.status(500).json({ received: false });
  }
});
module.exports = router;
