// Dedicated Stripe client for the invitation-only campaign; never changes normal billing.
const Stripe=require('stripe'),config=require('./membership-mode.service');
let stripe=null,planCache=null;
function client(){if(!stripe)stripe=Stripe(config.secretKey());return stripe;}
function setClient(mock){stripe=mock;planCache=null;}
function returnUrl(base,app,query){return `${base}/api/payment/return?to=${encodeURIComponent(app)}&${query}`;}
async function getPlan() {
    if (planCache && planCache.expiresAt > Date.now()) return planCache.plan;
    const price = await client().prices.retrieve(config.priceId());
    if(config.live() && (!price.livemode||!price.active||price.type!=='recurring'))throw Object.assign(Error('Precio live no disponible.'),{status:503});
    const plan = {
        amountCents: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval || 'month',
        intervalCount: price.recurring?.interval_count || 1,
    };
    planCache = { plan, expiresAt: Date.now() + 10 * 60 * 1000 };
    return plan;
}

async function ensureCustomer(user, idempotencyKey) {
    if (user.stripe_customer_id) return user.stripe_customer_id;
    const customer = await client().customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { user_id: String(user.id) },
    }, idempotencyKey ? {idempotencyKey} : undefined);
    return customer.id;
}

async function createCheckoutSession({ user, customerId, baseUrl, appReturnUrl, renewalNotice, trialDays, invitationId, idempotencyKey, successUrl, cancelUrl }) {
    const session = await client().checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: String(user.id),
        line_items: [{ price: config.priceId(), quantity: 1 }],
        metadata: { purchase_type: 'subscription', user_id: String(user.id) },
        subscription_data: { metadata: { user_id: String(user.id), ...(invitationId ? {launch_invitation_id:invitationId} : {}) }, ...(trialDays ? {trial_period_days:trialDays,trial_settings:{end_behavior:{missing_payment_method:'cancel'}}} : {}) },
        ...(trialDays ? {payment_method_collection:'always',payment_method_types:['card']} : {}),
        // Recordatorio de renovación automática junto al botón de pago.
        custom_text: { submit: { message: renewalNotice } },
        success_url: successUrl || returnUrl(baseUrl, appReturnUrl, 'result=success&session_id={CHECKOUT_SESSION_ID}'),
        cancel_url: cancelUrl || returnUrl(baseUrl, appReturnUrl, 'result=cancel'),
    }, idempotencyKey ? {idempotencyKey} : undefined);
    return { id: session.id, url: session.url };
}

async function createLaunchSetup({customerId,userId,invitationId,key}) {
    return client().setupIntents.create({customer:customerId,payment_method_types:['card'],usage:'off_session',metadata:{user_id:String(userId),launch_invitation_id:invitationId}},{idempotencyKey:key});
}
async function retrieveLaunchSetup(id) { return client().setupIntents.retrieve(id); }
async function createLaunchSubscription({customerId,userId,paymentMethod,invitationId,key}) {
    return client().subscriptions.create({customer:customerId,items:[{price:config.priceId()}],default_payment_method:paymentMethod,collection_method:'charge_automatically',trial_period_days:30,trial_settings:{end_behavior:{missing_payment_method:'cancel'}},metadata:{user_id:String(userId),launch_invitation_id:invitationId}},{idempotencyKey:key});
}


function retrieveCheckoutSession(id,options){return client().checkout.sessions.retrieve(id,options);}
function expireCheckoutSession(id){return client().checkout.sessions.expire(id);}
function retrieveSubscription(id){return client().subscriptions.retrieve(id);}
function setSubscriptionRenewal(id,cancel){return client().subscriptions.update(id,{cancel_at_period_end:cancel});}
async function cancelSubscriptionNow(id){try{return await client().subscriptions.cancel(id);}catch(e){if(e.code==='resource_missing')return null;throw e;}}
async function createPortalSession({customerId,returnUrl}){return (await client().billingPortal.sessions.create({customer:customerId,return_url:returnUrl})).url;}
function constructWebhookEvent(body,signature){return client().webhooks.constructEvent(body,signature,config.webhookSecret());}
module.exports={retrievePaymentLink:id=>client().paymentLinks.retrieve(id),listPaymentLinkItems:id=>client().paymentLinks.listLineItems(id,{limit:2}),linkLaunchSubscription:(id,metadata)=>client().subscriptions.update(id,{metadata}),cancelDuplicateTrial:id=>client().subscriptions.cancel(id,{invoice_now:false,prorate:false}),retrieveInvoice:id=>client().invoices.retrieve(id),setClient,getPlan,ensureCustomer,createCheckoutSession,createLaunchSetup,retrieveLaunchSetup,createLaunchSubscription,retrieveCheckoutSession,expireCheckoutSession,retrieveSubscription,setSubscriptionRenewal,cancelSubscriptionNow,createPortalSession,constructWebhookEvent};
