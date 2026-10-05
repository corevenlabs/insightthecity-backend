const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const stripe = require('../services/stripe.service');
const mail = require('../services/password-reset-mail.service');
const service = require('../services/subscription-renewal.service');
const controller = require('../controllers/payment.controller');

test('renovación conserva acceso, verifica titularidad y admite reactivación e intentos repetidos', async t => {
  const original = { connect: db.connect, retrieve: stripe.retrieveSubscription, update: stripe.setSubscriptionRenewal, send: mail.send, configured: mail.isConfigured };
  let state, account, updates, notices, rollback, failMail;
  function reset() {
    state = { id: 'sub_owned', customer: 'cus_owned', status: 'active', cancel_at_period_end: false, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86400, price: { unit_amount: 999, currency: 'usd', recurring: { interval: 'month' } } }] } };
    account = { id: 7, stripe_customer_id: 'cus_owned', stripe_subscription_id: 'sub_owned', email: 'test@example.com', language: 'es' };
    updates = 0; notices = []; rollback = false; failMail = false;
  }
  reset();
  db.connect = async () => ({ release() {}, query: async (sql, values) => {
    if (sql.includes('SELECT *')) { assert.equal(values[0], 7); assert.match(sql, /FOR UPDATE/); return { rows: account ? [account] : [] }; }
    if (sql.includes('UPDATE users')) return { rows: [{ ...account, is_premium: values[9], subscription_cancel_at_period_end: values[5], subscription_current_period_end: new Date(values[4] * 1000), subscription_status: values[3] }] };
    if (sql === 'ROLLBACK') rollback = true;
    return {};
  } });
  stripe.retrieveSubscription = async id => { assert.equal(id, 'sub_owned'); return state; };
  stripe.setSubscriptionRenewal = async (id, cancel) => { assert.equal(id, 'sub_owned'); updates++; state = { ...state, cancel_at_period_end: cancel }; return state; };
  mail.isConfigured = () => true;
  mail.send = async message => { if (failMail) throw Object.assign(new Error('mail'), { code: 'TEST_FAILURE' }); notices.push(message); };
  try {
    await t.test('cancelación y reactivación sin retirar premium ni duplicar correos', async () => {
      const canceled = await service.changeRenewal(7, true);
      assert.equal(canceled.user.is_premium, true);
      assert.equal(canceled.user.subscription_cancel_at_period_end, true);
      assert.equal(canceled.emailSent, true);
      assert.equal((await service.changeRenewal(7, true)).changed, false);
      assert.equal(updates, 1); assert.equal(notices.length, 1);
      const resumed = await service.changeRenewal(7, false);
      assert.equal(resumed.user.subscription_cancel_at_period_end, false);
      assert.equal(updates, 2); assert.equal(notices.length, 2);
    });
    await t.test('cuenta sin pago y suscripción de otro cliente se rechazan antes de cambiar Stripe', async () => {
      reset(); account = null;
      await assert.rejects(service.changeRenewal(7, true), error => error.status === 404);
      reset(); state.customer = 'cus_someone_else';
      await assert.rejects(service.changeRenewal(7, true), error => error.status === 403);
      assert.equal(updates, 0); assert.equal(rollback, true);
    });
    await t.test('planes finalizados, fechas desconocidas y programaciones especiales no se modifican', async () => {
      for (const change of [s => { s.status = 'canceled'; }, s => { s.schedule = 'schedule'; }, s => { s.items.data[0].current_period_end = 0; }, s => { s.cancel_at = 123; }]) {
        reset(); change(state); await assert.rejects(service.changeRenewal(7, false), error => error.status === 409);
        assert.equal(updates, 0);
      }
    });
    await t.test('fallo del correo no oculta una cancelación confirmada', async () => {
      reset(); failMail = true;
      const result = await service.changeRenewal(7, true);
      assert.equal(result.user.subscription_cancel_at_period_end, true);
      assert.equal(result.emailSent, false);
    });
    await t.test('Stripe fallido no confirma cancelación ni envía correo', async () => {
      reset(); const update = stripe.setSubscriptionRenewal;
      stripe.setSubscriptionRenewal = async () => { throw new Error('Stripe unavailable'); };
      await assert.rejects(service.changeRenewal(7, true));
      assert.equal(rollback, true); assert.equal(notices.length, 0);
      stripe.setSubscriptionRenewal = update;
    });
    await t.test('API exige confirmación explícita y booleano', async () => {
      for (const body of [{ cancelAtPeriodEnd: true }, { confirm: true, cancelAtPeriodEnd: 'true' }]) {
        const res = { status(code) { assert.equal(code, 400); return this; }, json(value) { assert.equal(value.success, false); } };
        await controller.changeRenewal({ body, user: { id: 7 } }, res, error => { throw error; });
      }
    });
  } finally {
    db.connect = original.connect; stripe.retrieveSubscription = original.retrieve; stripe.setSubscriptionRenewal = original.update; mail.send = original.send; mail.isConfigured = original.configured;
  }
});
