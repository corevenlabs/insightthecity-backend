const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const push = require('../services/push-notifications.service');
const subscriptions = require('../services/subscription.service');

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

// Minimal fake of the tables the service touches.
function fakeDb({ user, tokens = [TOKEN_A], kind = 'membership_active', createdAt = new Date() }) {
  const state = { message: { id: 'm1', user_id: user?.id ?? 7, kind, status: 'pending', attempts: 0, created_at: createdAt }, tokens: [...tokens], tickets: [], finished: null, postponed: null, calls: [] };
  const query = async (sql, values = []) => {
    state.calls.push([sql, values]);
    if (/UPDATE push_messages SET locked_at=NOW\(\), attempts/.test(sql)) { state.message.attempts++; return { rows: [state.message] }; }
    if (/FROM users/.test(sql)) return { rows: user ? [user] : [] };
    if (/SELECT token FROM push_tokens/.test(sql)) return { rows: state.tokens.map((token) => ({ token })) };
    if (/INSERT INTO push_tickets/.test(sql)) { state.tickets.push(values); return { rows: [] }; }
    if (/DELETE FROM push_tokens WHERE token=\$1$/.test(sql)) { state.tokens = state.tokens.filter((t) => t !== values[0]); return { rowCount: 1, rows: [] }; }
    if (/UPDATE push_messages SET status=\$2/.test(sql)) { state.finished = { status: values[1], error: values[2] }; return { rows: [] }; }
    if (/next_attempt_at=NOW\(\)\+make_interval/.test(sql)) { state.postponed = values[1]; return { rows: [] }; }
    throw new Error(`Unexpected query: ${sql}`);
  };
  return { state, query };
}

async function withFakes({ dbQuery, transport }, fn) {
  const originalQuery = db.query;
  const previous = push.setTransport(transport || (async () => { throw new Error('transport should not be called'); }));
  db.query = dbQuery;
  try { await fn(); } finally { db.query = originalQuery; push.setTransport(previous); }
}

const member = { id: 7, language: 'en', is_active: true, is_premium: true, subscription_status: 'active', push_account_notices: true };

test('only Expo push tokens and known platforms are accepted', async () => {
  const calls = [];
  await withFakes({ dbQuery: async (sql, values) => { calls.push([sql, values]); return { rows: [] }; } }, async () => {
    for (const token of ['', 'abc', 'ExponentPushToken[]', `ExponentPushToken[${'a'.repeat(200)}]`, 'ExponentPushToken[a b c d e f g h]', null])
      await assert.rejects(push.registerToken(7, { token, platform: 'ios' }), { status: 400 });
    await assert.rejects(push.registerToken(7, { token: TOKEN_A, platform: 'web' }), { status: 400 });
    await assert.rejects(push.setPreferences(7, { account: 'false' }), { status: 400 });
    await push.registerToken(7, { token: TOKEN_A, platform: 'ios' });
    await push.registerToken(7, { token: TOKEN_B, platform: 'android' });
  });
  assert.match(calls[0][0], /ON CONFLICT\(token\) DO UPDATE SET user_id=EXCLUDED.user_id/);
  assert.deepEqual(calls[0][1], [TOKEN_A, 7, 'ios']);
  assert.deepEqual(calls[2][1], [TOKEN_B, 7, 'android']);
});

test('copy is localized, carries only an in-app route and falls back to Spanish', () => {
  const experience = { id: 'jazz-night', title: 'Jazz en Harlem', ends_at: new Date(Date.now() + 86400000).toISOString(), benefit_action: 'none' };
  for (const kind of Object.keys(push.KINDS)) for (const language of ['es', 'en', 'pt']) {
    const message = push.render(kind, language, experience, { is_premium: true });
    assert.ok(message.title && message.body);
    assert.match(message.data.url, /^\/[a-z]/);
    assert.deepEqual(Object.keys(message.data), ['url']);
    assert.equal(message.channelId, push.KINDS[kind].channel || 'account');
  }
  assert.equal(push.render('payment_failed', 'fr').title, push.KINDS.payment_failed.copy.es[0]);
});

test('delivers to every device, stores tickets and drops unregistered devices', async () => {
  const { state, query } = fakeDb({ user: member, tokens: [TOKEN_A, TOKEN_B] });
  let sent;
  await withFakes({ dbQuery: query, transport: async (url, body) => {
    sent = { url, body };
    return { status: 200, data: { data: [{ status: 'ok', id: 'ticket-1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] } };
  } }, async () => assert.equal(await push.deliver('m1'), true));
  assert.match(sent.url, /exp\.host\/--\/api\/v2\/push\/send$/);
  assert.deepEqual(sent.body.map((m) => m.to), [TOKEN_A, TOKEN_B]);
  assert.equal(sent.body[0].title, 'Your ITC Club membership is active');
  assert.deepEqual(state.tickets, [['ticket-1', 'm1', TOKEN_A]]);
  assert.deepEqual(state.tokens, [TOKEN_A]);
  assert.deepEqual(state.finished, { status: 'sent', error: null });
});

test('skips opted-out, stale, deviceless, deleted and expired notices without calling Expo', async () => {
  const cases = [
    [{ user: { ...member, push_account_notices: false } }, 'opted_out'],
    [{ user: { ...member, is_premium: false } }, 'stale'],
    [{ user: member, tokens: [] }, 'no_devices'],
    [{ user: null }, 'account_unavailable'],
    [{ user: { ...member, is_active: false } }, 'account_unavailable'],
    [{ user: member, createdAt: new Date(Date.now() - 49 * 3600 * 1000) }, 'expired'],
    [{ user: { ...member, subscription_status: 'active' }, kind: 'payment_failed' }, 'stale'],
  ];
  for (const [options, reason] of cases) {
    const { state, query } = fakeDb(options);
    await withFakes({ dbQuery: query }, async () => assert.equal(await push.deliver('m1'), false));
    assert.deepEqual(state.finished, { status: 'skipped', error: reason });
  }
});

test('Expo outages are retried later instead of failing the caller', async () => {
  const { state, query } = fakeDb({ user: member });
  await withFakes({ dbQuery: query, transport: async () => ({ status: 503, data: {} }) }, async () => assert.equal(await push.deliver('m1'), false));
  assert.equal(state.postponed, 'http_503');
  assert.equal(state.finished, null);
});

test('membership changes enqueue one notice per subscription and never throw', async () => {
  const keys = [];
  const originalQuery = db.query;
  db.query = async (sql, values) => { if (/INSERT INTO push_messages/.test(sql)) keys.push(values.slice(1, 3)); return { rows: [] }; };
  try {
    await subscriptions.notifyMembership({ id: 7, stripe_subscription_id: 'sub_1', is_premium: true, subscription_status: 'trialing' });
    await subscriptions.notifyMembership({ id: 7, stripe_subscription_id: 'sub_1', is_premium: false, subscription_status: 'canceled' });
    await subscriptions.notifyMembership({ id: 7, stripe_subscription_id: 'sub_1', is_premium: false, subscription_status: 'incomplete_expired' });
    await subscriptions.notifyMembership({ id: 7, stripe_subscription_id: null, is_premium: true, subscription_status: 'active' });
    db.query = async () => { throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' }); };
    await subscriptions.notifyMembership({ id: 7, stripe_subscription_id: 'sub_2', is_premium: true, subscription_status: 'active' });
  } finally { db.query = originalQuery; }
  assert.deepEqual(keys, [['membership_active', 'membership_active:sub_1'], ['membership_ended', 'membership_ended:sub_1']]);
});
