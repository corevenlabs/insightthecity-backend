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

async function createGuideCheckoutSession({ guide, user }) {
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
            price_data: {
                currency: guide.currency,
                unit_amount: guide.priceCents,
                product_data: {
                    name: guide.title,
                    description: `Guía digital de Insight The City: ${guide.title}`,
                    ...(guide.coverUrl?.startsWith('https://') ? { images: [guide.coverUrl] } : {}),
                },
            },
            quantity: 1,
        }],
        customer_email: user.email,
        client_reference_id: String(user.id),
        metadata: {
            purchase_type: 'guide',
            guide_id: String(guide.id),
            user_id: String(user.id),
            price_cents: String(guide.priceCents),
            currency: guide.currency,
        },
        success_url: `https://success.miapp.com/guide-purchase?session_id={CHECKOUT_SESSION_ID}&guide_id=${guide.id}`,
        cancel_url: `https://cancel.miapp.com/guide-purchase?guide_id=${guide.id}`,
    });
    return { id: session.id, url: session.url };
}

async function retrieveCheckoutSession(sessionId) {
    return stripe.checkout.sessions.retrieve(sessionId);
}

module.exports = {
    createCheckoutSession,
    createGuideCheckoutSession,
    retrieveCheckoutSession,
};
