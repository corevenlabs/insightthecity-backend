const express = require("express");
const router = express.Router();

const stripeService = require("../services/stripe.service");
const subscriptions = require("../services/subscription.service");

// Mantiene la membresía al día con Stripe (renovaciones, cobros fallidos, cancelaciones).
// Se monta con express.raw: la firma se verifica sobre el body original.
router.post("/", async (req, res) => {
    let event;
    let campaignSignature=false;
    try {
        event = stripeService.constructWebhookEvent(req.body, req.headers["stripe-signature"]);
    } catch (err) {
        try {
            if(!require('../services/membership-mode.service').live())throw err;
            event=require('../services/membership-campaign-stripe.service').constructWebhookEvent(req.body,req.headers['stripe-signature']);
            campaignSignature=true;
        } catch {
            return res.status(400).send("Webhook signature error");
        }
    }

    // A dedicated live campaign destination can receive ordinary subscription events
    // from the same Stripe account. It must never apply them to normal members.
    if(['invoice.payment_failed','invoice.payment_action_required','invoice.paid'].includes(event.type)){
        try{await require('../services/membership-payment-alert.service').handle(event,campaignSignature?'campaign':'normal');return res.json({received:true});}
        catch{return res.status(500).json({received:false});}
    }
    if(campaignSignature&&['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&require('../services/membership-payment-link.service').isSession(event.data.object)){
        try{await require('../services/membership-payment-link.service').confirmSession(event.data.object.id);return res.json({received:true});}catch{return res.status(500).json({received:false});}
    }
    if(campaignSignature && !event.data.object.metadata?.launch_invitation_id)return res.json({received:true});
    try {
        if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
            const session = event.data.object;
            if (session.metadata?.purchase_type === "partner" && session.payment_status === "paid") await require("../services/partner-crm.service").confirmPayment(session);
            if (session.mode === "subscription" && session.client_reference_id) {
                await subscriptions.confirmCheckout(session.client_reference_id, session.id, campaignSignature?require('../services/membership-campaign-stripe.service'):stripeService);
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
