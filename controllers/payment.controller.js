const db = require('../config/db');
const stripeService = require('../services/stripe.service');
const subscriptions = require('../services/subscription.service');
const legal = require('../services/legal.service');
const { publicUser } = require('../services/users.service');
const { isAllowedAppUrl, publicBaseUrl } = require('../utils/appReturn');
const { escapeHtml } = require('../utils/legalMarkdown');

async function loadUser(id) {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
}

// GET /api/payment/plan — precio real del plan para mostrarlo antes de pagar.
async function getPlan(req, res, next) {
    try {
        res.json({ success: true, plan: await stripeService.getPlan() });
    } catch (error) {
        next(error);
    }
}

// POST /api/payment/create-subscription { autorenewConsent: true, returnUrl }
async function createSubscription(req, res, next) {
    try {
        const { autorenewConsent, returnUrl } = req.body || {};
        if (autorenewConsent !== true) {
            return res.status(400).json({ success: false, message: 'Debes aceptar la renovación automática para continuar.' });
        }
        if (!isAllowedAppUrl(returnUrl)) {
            return res.status(400).json({ success: false, message: 'URL de retorno inválida.' });
        }

        const user = await loadUser(req.user.id);
        if (!user?.is_active) return res.status(403).json({ success: false, message: 'Tu cuenta no está activa.' });
        if (user.stripe_subscription_id && subscriptions.PREMIUM_STATUSES.has(user.subscription_status)) {
            return res.status(409).json({ success: false, message: 'Ya tienes una membresía activa.' });
        }

        const language = user.language || 'es';
        const [plan, customerId] = await Promise.all([stripeService.getPlan(), stripeService.ensureCustomer(user)]);

        // Prueba del consentimiento: momento + versión vigente de los términos de suscripción.
        await db.query(
            'UPDATE users SET stripe_customer_id = $2, autorenew_consent_at = NOW() WHERE id = $1',
            [user.id, customerId]
        );
        await legal.recordAcceptance(null, {
            userId: user.id, language, context: 'subscription', slugs: legal.SUBSCRIPTION_SLUGS,
        });

        const session = await stripeService.createCheckoutSession({
            user,
            customerId,
            baseUrl: publicBaseUrl(req),
            appReturnUrl: returnUrl,
            renewalNotice: subscriptions.renewalNotice(plan, language),
        });
        res.json({ success: true, checkoutUrl: session.url, sessionId: session.id });
    } catch (error) {
        next(error);
    }
}

// POST /api/payment/confirm-subscription { sessionId } — activa premium tras verificar con Stripe.
async function confirmSubscription(req, res, next) {
    try {
        const sessionId = String(req.body?.sessionId || '');
        if (!sessionId.startsWith('cs_')) {
            return res.status(400).json({ success: false, message: 'Sesión de pago inválida.' });
        }
        const user = await subscriptions.confirmCheckout(req.user.id, sessionId);
        if (!user) return res.status(409).json({ success: false, message: 'El pago todavía no ha sido confirmado.' });
        res.json({ success: true, user: publicUser(user) });
    } catch (error) {
        next(error);
    }
}

// POST /api/payment/portal { returnUrl } — Stripe Customer Portal para administrar o cancelar.
async function createPortal(req, res, next) {
    try {
        const { returnUrl } = req.body || {};
        if (!isAllowedAppUrl(returnUrl)) {
            return res.status(400).json({ success: false, message: 'URL de retorno inválida.' });
        }
        const user = await loadUser(req.user.id);
        if (!user?.stripe_customer_id) {
            return res.status(404).json({ success: false, message: 'No tienes una suscripción pagada para administrar.' });
        }
        const url = await stripeService.createPortalSession({
            customerId: user.stripe_customer_id,
            returnUrl: stripeService.returnUrl(publicBaseUrl(req), returnUrl, 'result=portal'),
        });
        // Fuerza re-sincronizar al volver: el usuario pudo cancelar en el portal.
        await db.query('UPDATE users SET subscription_synced_at = NULL WHERE id = $1', [user.id]);
        res.json({ success: true, url });
    } catch (error) {
        next(error);
    }
}

// GET /api/payment/return?to=itcclub://...&result=... — página puente de Stripe a la app.
function returnToApp(req, res) {
    const { to, ...params } = req.query;
    if (!isAllowedAppUrl(to)) return res.status(400).send('Destino inválido');
    const query = new URLSearchParams();
    for (const key of ['result', 'session_id', 'guide_id']) {
        if (typeof params[key] === 'string') query.set(key, params[key]);
    }
    const target = `${to}${to.includes('?') ? '&' : '?'}${query.toString()}`;
    res.set('Cache-Control', 'no-store');
    res.type('html').send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ITC Club</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#fff;font-family:-apple-system,system-ui,sans-serif;text-align:center}a{display:inline-block;margin-top:18px;padding:14px 22px;border-radius:12px;background:#D4AF37;color:#000;font-weight:700;text-decoration:none}</style>
</head><body><main><p>Volviendo a ITC Club… / Returning to ITC Club…</p><a href="${escapeHtml(target)}">Abrir la app / Open the app</a></main>
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});</script>
</body></html>`);
}

module.exports = {
    getPlan,
    createSubscription,
    confirmSubscription,
    createPortal,
    returnToApp,
};
