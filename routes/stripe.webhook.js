const express = require("express");
const router = express.Router();

const stripeService = require("../services/stripe.service");
const subscriptions = require("../services/subscription.service");

// Mantiene la membresía al día con Stripe (renovaciones, cobros fallidos, cancelaciones).
// Se monta con express.raw: la firma se verifica sobre el body original.
router.post("/", async (req, res) => {
    let event;
    try {
        event = stripeService.constructWebhookEvent(req.body, req.headers["stripe-signature"]);
    } catch (err) {
        console.error("[stripe webhook] Firma inválida:", err.message);
        return res.status(400).send("Webhook signature error");
    }

    try {
        if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
            const session = event.data.object;
            if (session.metadata?.purchase_type === "partner" && session.payment_status === "paid") await require("../services/partner-crm.service").confirmPayment(session);
            if (session.mode === "subscription" && session.client_reference_id) {
                await subscriptions.confirmCheckout(session.client_reference_id, session.id);
            }
        } else if (
            event.type === "customer.subscription.created" ||
            event.type === "customer.subscription.updated" ||
            event.type === "customer.subscription.deleted"
        ) {
            await subscriptions.applyFromWebhook(event.data.object);
        }
    } catch (err) {
        // 500 hace que Stripe reintente el evento.
        console.error(`[stripe webhook] Error procesando ${event.type}:`, err.message);
        return res.status(500).json({ received: false });
    }

    res.json({ received: true });
});

module.exports = router;
