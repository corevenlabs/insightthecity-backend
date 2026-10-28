const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');

test('webhooks aplican el estado actual en Stripe y no pisan la suscripción activa con otra', async () => {
  const subscriptions = require('../services/subscription.service');
  const originalQuery = db.query;
  const users = { 7: { stripe_subscription_id: 'sub_B', subscription_status: 'active' } };
  const updates = [];
  db.query = async (sql, values) => {
    if (/SELECT stripe_subscription_id, subscription_status FROM users/.test(sql)) return { rows: [users[values[0]]].filter(Boolean) };
    if (/UPDATE users SET\s+stripe_customer_id/.test(sql)) { updates.push(values); return { rows: [{ id: values[0], stripe_subscription_id: values[2], subscription_status: values[3] }] }; }
    return { rows: [], rowCount: 0 };
  };
  const item = { current_period_end: 1893456000, price: { unit_amount: 499, currency: 'usd', recurring: { interval: 'month' } } };
  const live = {
    sub_A: { id: 'sub_A', status: 'canceled', customer: 'cus_1', metadata: { user_id: '7' }, items: { data: [item] } },
    sub_B: { id: 'sub_B', status: 'past_due', customer: 'cus_1', metadata: { user_id: '7' }, items: { data: [item] } },
  };
  const billing = { retrieveSubscription: async (id) => live[id] };
  try {
    // Un evento tardío de la suscripción vieja A no retira la membresía que da B.
    assert.equal(await subscriptions.applyFromWebhook({ id: 'sub_A', status: 'active', metadata: { user_id: '7' } }, billing), null);
    assert.equal(updates.length, 0);
    // Un evento reintentado de B con datos viejos ("active") aplica el estado real ("past_due").
    await subscriptions.applyFromWebhook({ id: 'sub_B', status: 'active', metadata: { user_id: '7' } }, billing);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].slice(2, 4), ['sub_B', 'past_due']);
    // Si la actual ya no está activa, una suscripción nueva sí se aplica (volver a suscribirse).
    users[7] = { stripe_subscription_id: 'sub_A', subscription_status: 'canceled' };
    await subscriptions.applyFromWebhook({ id: 'sub_B', metadata: { user_id: '7' } }, billing);
    assert.equal(updates.length, 2);
  } finally {
    db.query = originalQuery;
  }
});

test('la alianza destacada no publicada solo la ve el staff', async () => {
  const service = require('../services/partnerships.service');
  const { getFeatured } = require('../controllers/partnerships.controller');
  const original = service.getFeatured;
  service.getFeatured = async () => ({ brand_name: 'Secreta', title: 'Lanzamiento', is_published: false });
  const call = async (req) => { let body; await getFeatured(req, { json: (b) => { body = b; return b; }, status() { return this; } }, (e) => { throw e; }); return body; };
  try {
    assert.deepEqual(await call({}), { success: true, partnership: null });
    assert.equal((await call({ admin: { id: 1, role: 'editor' } })).partnership.brandName, 'Secreta');
    service.getFeatured = async () => ({ brand_name: 'Pública', is_published: true });
    assert.equal((await call({})).partnership.brandName, 'Pública');
  } finally {
    service.getFeatured = original;
  }
});
