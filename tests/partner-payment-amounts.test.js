const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paymentAmounts } = require('../services/partner-payment-amounts');
test('only agreed discount plus completed Stripe tax is accepted for live partners', () => {
  const row = { offer: 'founding', amount_cents: 30000 };
  const session = { livemode: true, currency: 'usd', amount_subtotal: 120000, amount_total: 32000,
    total_details: { amount_discount: 90000, amount_tax: 2000, amount_shipping: 0 }, automatic_tax: { enabled: true, status: 'complete' } };
  assert.deepEqual(paymentAmounts(session, row), { subtotal: 120000, discount: 90000, tax: 2000, total: 32000, currency: 'usd' });
  for (const change of [{ amount_total: 32001 }, { amount_subtotal: 130000 }, { automatic_tax: { enabled: true, status: 'requires_location_inputs' } }, { total_details: { ...session.total_details, amount_discount: 80000 } }, { total_details: { ...session.total_details, amount_shipping: 1 } }, { total_details: undefined }]) assert.equal(paymentAmounts({ ...session, ...change }, row), null);
  assert.equal(paymentAmounts({ ...session, amount_total: 30000, total_details: { ...session.total_details, amount_tax: 0 } }, row).total, 30000);
  const free = { ...session, amount_subtotal: 180000, amount_total: 0, total_details: { amount_discount: 180000, amount_tax: 0, amount_shipping: 0 } };
  assert.equal(paymentAmounts(free, { offer: 'strategic', amount_cents: 0 }).total, 0);
  assert.equal(paymentAmounts({ ...free, amount_total: 1, total_details: { ...free.total_details, amount_tax: 1 } }, { offer: 'strategic', amount_cents: 0 }), null);
});
