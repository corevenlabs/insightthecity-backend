const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const transport = require('../services/password-reset-mail.service');
const subscriptions = require('../services/subscription.service');

test('al refrescar el perfil se reintenta el acuse pendiente usando el transporte SMTP compartido', async () => {
  const original = { query: db.query, configured: transport.isConfigured, send: transport.send };
  let claimed = false;
  const messages = [];
  const user = { id: 7, email: 'test@example.com', language: 'es', stripe_subscription_id: 'sub_test', subscription_status: 'active', subscription_synced_at: new Date(), subscription_amount_cents: 999, subscription_currency: 'usd', subscription_interval: 'month' };
  try {
    transport.isConfigured = () => true;
    transport.send = async message => messages.push(message);
    db.query = async sql => {
      if (sql.startsWith('SELECT')) return { rows: [user] };
      if (sql.includes('subscription_confirmation_sent_for = $2')) {
        const rowCount = claimed ? 0 : 1; claimed = true; return { rowCount };
      }
      throw new Error('Unexpected query');
    };
    await subscriptions.syncIfStale(7);
    await subscriptions.syncIfStale(7);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].to, ['test@example.com']);
    assert.match(messages[0].subject, /membresía/);
  } finally { db.query = original.query; transport.isConfigured = original.configured; transport.send = original.send; }
});
