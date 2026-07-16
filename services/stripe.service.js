const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

async function createCheckoutSession({ email }) {
    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
            {
                price: process.env.STRIPE_PRICE_ID,
                quantity: 1,
            },
        ],
        customer_email: email,
        success_url: 'https://success.miapp.com',
        cancel_url: 'https://cancel.miapp.com',
    });

    return session.url;
}

module.exports = {
    createCheckoutSession,
};