const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const stripeService = require('../services/stripe.service');
const subscriptions = require('../services/subscription.service');
const users = require('../services/users.service');
const usersController = require('../controllers/users.controller');
const paymentController = require('../controllers/payment.controller');
const { isAllowedAppUrl } = require('../utils/appReturn');
const { toHtml } = require('../utils/legalMarkdown');

function fakeRes() {
  return {
    statusCode: 200, body: null, headers: {}, kind: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    type(kind) { this.kind = kind; return this; },
  };
}

test('la página puente solo vuelve a esquemas de la app (sin open redirect)', () => {
  assert.equal(isAllowedAppUrl('itcclub://checkout-return'), true);
  assert.equal(isAllowedAppUrl('exp://192.168.0.5:8081/--/checkout-return'), true);
  assert.equal(isAllowedAppUrl('https://evil.example.com'), false);
  assert.equal(isAllowedAppUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedAppUrl('itcclub://x"><script>'), false);

  const res = fakeRes();
  paymentController.returnToApp({ query: { to: 'https://evil.example.com', result: 'success' } }, res);
  assert.equal(res.statusCode, 400);

  const ok = fakeRes();
  paymentController.returnToApp({ query: { to: 'itcclub://checkout-return', result: 'success', session_id: 'cs_123', extra: 'x' } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body, /itcclub:\/\/checkout-return\?result=success&session_id=cs_123/);
  assert.doesNotMatch(ok.body, /extra=/);
});

test('el markdown legal escapa HTML', () => {
  const html = toHtml('# Título\n\nHola <script>alert(1)</script> **negrita**\n\n- uno\n- dos');
  assert.match(html, /<h2>Título<\/h2>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>negrita<\/strong>/);
  assert.match(html, /<ul><li>uno<\/li><li>dos<\/li><\/ul>/);
});

test('el registro exige consentimiento afirmativo a Términos y Privacidad', async () => {
  const res = fakeRes();
  await usersController.register({ body: { name: 'Ana', email: 'ana@example.com', password: '12345678' } }, res, assert.fail);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Términos/);
});

test('suscribirse exige aceptar la renovación automática', async () => {
  const res = fakeRes();
  await paymentController.createSubscription(
    { user: { id: 1 }, body: { returnUrl: 'itcclub://checkout-return' } }, res, assert.fail,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /renovación automática/);
});

test('premium solo se activa con una sesión de Stripe completa del mismo usuario', async () => {
  const originalQuery = db.query;
  const updates = [];
  db.query = async (sql, values) => {
    if (sql.includes('UPDATE users SET') && sql.includes('stripe_subscription_id = $3')) {
      updates.push(values);
      return { rows: [{ id: values[0], subscription_status: values[3], is_premium: values[9] }] };
    }
    return { rows: [], rowCount: 0 };
  };
  const subscription = {
    id: 'sub_1', status: 'active', customer: 'cus_1', cancel_at_period_end: false,
    items: { data: [{ current_period_end: 1893456000, price: { unit_amount: 499, currency: 'usd', recurring: { interval: 'month' } } }] },
  };
  stripeService.setClient({
    checkout: { sessions: { retrieve: async (id) => ({
      id, mode: 'subscription', status: 'complete', client_reference_id: id === 'cs_other' ? '99' : '7', subscription,
    }) } },
  });
  try {
    assert.equal(await subscriptions.confirmCheckout(7, 'cs_other'), null);
    assert.equal(updates.length, 0);

    const user = await subscriptions.confirmCheckout(7, 'cs_mine');
    assert.equal(user.is_premium, true);
    assert.deepEqual(updates[0].slice(0, 4), [7, 'cus_1', 'sub_1', 'active']);
    assert.equal(updates[0][6], 499);
  } finally {
    db.query = originalQuery;
    stripeService.setClient(null);
  }
});

test('una suscripción cancelada retira premium', async () => {
  const originalQuery = db.query;
  let premium;
  db.query = async (sql, values) => { premium = values[9]; return { rows: [{ id: 1 }] }; };
  try {
    await subscriptions.applySubscription(1, { id: 'sub_1', status: 'canceled', customer: 'cus_1', items: { data: [] } });
    assert.equal(premium, false);
    await subscriptions.applySubscription(1, { id: 'sub_1', status: 'past_due', customer: 'cus_1', items: { data: [] } });
    assert.equal(premium, true);
  } finally {
    db.query = originalQuery;
  }
});

test('eliminar la cuenta cancela la suscripción antes de borrar; si Stripe falla no borra nada', async () => {
  const originalQuery = db.query;
  const originalConnect = db.connect;
  const statements = [];
  const client = {
    query: async (sql) => { statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); return { rows: [] }; },
    release() {},
  };
  db.query = async (sql) => {
    if (sql.includes('stripe_subscription_id, subscription_status')) {
      return { rows: [{ stripe_subscription_id: 'sub_1', subscription_status: 'active' }] };
    }
    return { rows: [] };
  };
  db.connect = async () => client;
  let canceled = 0;
  try {
    stripeService.setClient({ subscriptions: { cancel: async () => { throw Object.assign(new Error('down'), { code: 'api_error' }); } } });
    await assert.rejects(users.remove(5), /down/);
    assert.equal(statements.length, 0);

    stripeService.setClient({ subscriptions: { cancel: async () => { canceled += 1; } } });
    assert.equal(await users.remove(5), true);
    assert.equal(canceled, 1);
    assert.ok(statements.includes('DELETE FROM chat_messages'));
    assert.ok(statements.includes('DELETE FROM users'));
  } finally {
    db.query = originalQuery;
    db.connect = originalConnect;
    stripeService.setClient(null);
  }
});

test('el aviso de renovación muestra precio y período en el idioma del usuario', () => {
  const plan = { amountCents: 499, currency: 'usd', interval: 'month' };
  assert.match(subscriptions.renewalNotice(plan, 'es'), /se renueva automáticamente por \$4\.99\/mes/);
  assert.match(subscriptions.renewalNotice(plan, 'en'), /renews automatically at \$4\.99\/month/);
  const email = subscriptions.confirmationEmail(
    { name: 'Ana', subscription_amount_cents: 499, subscription_currency: 'usd', subscription_interval: 'month' }, 'es',
  );
  assert.match(email.text, /Cómo cancelar/);
  assert.match(email.text, /renueva automáticamente/);
});
