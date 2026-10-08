const Stripe = require('stripe');

// Cliente perezoso: permite arrancar (y testear) sin STRIPE_SECRET_KEY.
let stripe = null;
function client() {
    if (!stripe) stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    return stripe;
}
function setClient(mock) {
    stripe = mock;
}

// URL de la página puente que devuelve al usuario a la app tras Stripe.
// Stripe exige https en success_url, así que no puede apuntar al esquema itcclub://.
function returnUrl(baseUrl, appReturnUrl, query) {
    return `${baseUrl}/api/payment/return?to=${encodeURIComponent(appReturnUrl)}&${query}`;
}

// Precio del plan ITC Club, leído de Stripe para que la app muestre exactamente
// lo que se va a cobrar (requisito de divulgación de la ley de renovación automática).
let planCache = null;
async function getPlan() {
    if (planCache && planCache.expiresAt > Date.now()) return planCache.plan;
    const price = await client().prices.retrieve(process.env.STRIPE_PRICE_ID);
    const plan = {
        amountCents: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval || 'month',
        intervalCount: price.recurring?.interval_count || 1,
    };
    planCache = { plan, expiresAt: Date.now() + 10 * 60 * 1000 };
    return plan;
}

async function ensureCustomer(user) {
    if (user.stripe_customer_id) return user.stripe_customer_id;
    const customer = await client().customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { user_id: String(user.id) },
    });
    return customer.id;
}

async function createCheckoutSession({ user, customerId, baseUrl, appReturnUrl, renewalNotice }) {
    const session = await client().checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: String(user.id),
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        metadata: { purchase_type: 'subscription', user_id: String(user.id) },
        subscription_data: { metadata: { user_id: String(user.id) } },
        // Recordatorio de renovación automática junto al botón de pago.
        custom_text: { submit: { message: renewalNotice } },
        success_url: returnUrl(baseUrl, appReturnUrl, 'result=success&session_id={CHECKOUT_SESSION_ID}'),
        cancel_url: returnUrl(baseUrl, appReturnUrl, 'result=cancel'),
    });
    return { id: session.id, url: session.url };
}

async function createGuideCheckoutSession({ guide, user, baseUrl, appReturnUrl }) {
    const session = await client().checkout.sessions.create({
        mode: 'payment',
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
        success_url: returnUrl(baseUrl, appReturnUrl, `result=success&session_id={CHECKOUT_SESSION_ID}&guide_id=${guide.id}`),
        cancel_url: returnUrl(baseUrl, appReturnUrl, `result=cancel&guide_id=${guide.id}`),
    });
    return { id: session.id, url: session.url };
}

async function retrieveCheckoutSession(sessionId, options) {
    return client().checkout.sessions.retrieve(sessionId, options);
}

async function expireCheckoutSession(sessionId) { return client().checkout.sessions.expire(sessionId); }

async function retrieveSubscription(subscriptionId) {
    return client().subscriptions.retrieve(subscriptionId);
}

async function setSubscriptionRenewal(subscriptionId, cancelAtPeriodEnd) {
    return client().subscriptions.update(subscriptionId, { cancel_at_period_end: cancelAtPeriodEnd });
}

async function cancelSubscriptionNow(subscriptionId) {
    try {
        return await client().subscriptions.cancel(subscriptionId);
    } catch (error) {
        // Ya cancelada o inexistente en Stripe: no hay cobro pendiente que detener.
        if (error?.code === 'resource_missing') return null;
        throw error;
    }
}

async function createPortalSession({ customerId, returnUrl: url }) {
    const session = await client().billingPortal.sessions.create({ customer: customerId, return_url: url });
    return session.url;
}

function constructWebhookEvent(rawBody, signature) {
    return client().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

async function createPartnerCheckout({row,returnUrl,key}) {
    return client().checkout.sessions.create({mode:'payment',customer_email:row.email,
        line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:row.amount_cents,product_data:{name:row.offer==='founding'?'ITC CLUB · Founding Partner · 6 months':'ITC CLUB · Partner · 6 months'}}}],
        metadata:{purchase_type:'partner',partner_id:row.id},success_url:returnUrl,cancel_url:returnUrl,
    },{idempotencyKey:key});
}
module.exports = {
    createPartnerCheckout,
    setClient,
    returnUrl,
    getPlan,
    ensureCustomer,
    createCheckoutSession,
    createGuideCheckoutSession,
    retrieveCheckoutSession,
    expireCheckoutSession,
    retrieveSubscription,
    setSubscriptionRenewal,
    cancelSubscriptionNow,
    createPortalSession,
    constructWebhookEvent,
};
