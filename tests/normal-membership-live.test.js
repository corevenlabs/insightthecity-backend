const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validPrice, validEndpoint, events } = require('../scripts/verify-normal-membership-live');
test('normal live membership rejects sandbox, wrong amount, currency and billing cadence', () => {
  const price = { livemode: true, active: true, unit_amount: 499, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } };
  assert.equal(validPrice(price), true);
  for (const change of [{ livemode: false }, { active: false }, { unit_amount: 4999 }, { currency: 'eur' }, { recurring: null }, { recurring: { interval: 'year', interval_count: 1 } }, { recurring: { interval: 'month', interval_count: 2 } }]) assert.equal(validPrice({ ...price, ...change }), false);
});
test('live webhook must belong to the expected route and handle all subscription and invoice events', () => {
  const endpoint = { url: 'https://itc-backend-1031252664334.us-east1.run.app/api/payment/webhook', status: 'enabled', livemode: true, enabled_events: events };
  assert.equal(validEndpoint(endpoint), true);
  assert.equal(validEndpoint({ ...endpoint, enabled_events: ['*'] }), true);
  for (const change of [{ status: 'disabled' }, { livemode: false }, { url: 'https://example.com' }, { enabled_events: events.slice(1) }]) assert.equal(validEndpoint({ ...endpoint, ...change }), false);
});
