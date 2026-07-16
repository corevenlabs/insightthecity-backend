const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const db = require("../config/db");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

router.post("/", (req, res) => {

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

        const sql =
            "UPDATE users SET is_premium = 1 WHERE email = ?";

        db.query(
            sql,
            [session.customer_email],
            (err, result) => {

                if (err) {
                    console.log("DB error:", err);
                    return;
                }

                console.log(
                    "Rows affected:",
                    result.affectedRows
                );

                console.log(
                    "User upgraded:",
                    session.customer_email
                );
            }
        );
    }

    res.json({ received: true });
});

module.exports = router;