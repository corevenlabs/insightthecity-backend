const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const db = require("../config/db");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

router.post("/", async (req, res) => {

    const sig = req.headers["stripe-signature"];

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );

        console.log("Webhook received:", event.type);

    } catch (err) {

        console.log(
            "Webhook signature error:",
            err.message
        );

        return res
            .status(400)
            .send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {

        const session = event.data.object;

        console.log("Checkout completed");
        console.log("Email:", session.customer_email);

        try {
            const result = await db.query(
                "UPDATE users SET is_premium = TRUE WHERE email = $1",
                [session.customer_email]
            );
            console.log("Rows affected:", result.rowCount);
            console.log("User upgraded:", session.customer_email);
        } catch (err) {
            console.log("DB error:", err);
        }
    }

    res.json({ received: true });
});

module.exports = router;