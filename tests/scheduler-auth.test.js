const test = require('node:test');
const assert = require('node:assert/strict');
const { ACCOUNT, BASE, isScheduler } = require('../middleware/scheduler-auth');
const worker = require('../services/worker.service');

const req = (token) => ({ headers: { authorization: token === undefined ? undefined : `Bearer ${token}` } });
const client = (claims, seen = []) => ({ seen, verifyIdToken: async (options) => { seen.push(options); if (!claims) throw new Error('bad token'); return { getPayload: () => claims }; } });

test('only the scheduler service account, with the audience of that endpoint, is accepted', async () => {
  const good = client({ email: ACCOUNT, email_verified: true });
  assert.equal(await isScheduler(req('a.b.c'), '/api/x', good), true);
  assert.deepEqual(good.seen, [{ idToken: 'a.b.c', audience: `${BASE}/api/x` }]);
  for (const claims of [{ email: 'other@example.test', email_verified: true }, { email: ACCOUNT }, { email: ACCOUNT, email_verified: 'true' }, undefined, null])
    assert.equal(await isScheduler(req('a.b.c'), '/api/x', client(claims)), false);
  const unused = client({ email: ACCOUNT, email_verified: true });
  for (const token of [undefined, '', 'x'.repeat(64), 'a.b', `a.${'b'.repeat(5000)}.c`, 'é.b.c'])
    assert.equal(await isScheduler(req(token), '/api/x', unused), false);
  assert.equal(unused.seen.length, 0);
});

test('both worker endpoints reject a token Google does not vouch for', async () => {
  process.env.JWT_SECRET = 'worker-test';
  const middleware = require('../middleware/membership-email-worker');
  let status;
  await middleware(req('a.b.c'), { status(code) { status = code; return this; }, json() {} }, () => assert.fail('untrusted worker'));
  assert.equal(status, 401);
});

test('a failing step does not stop the others and is still reported', async () => {
  const done = [];
  const original = console.error;
  console.error = () => {};
  try {
    await assert.rejects(worker.run([[null, async () => { done.push(1); }], ['b', async () => { throw new Error('b down'); }], ['c', async () => { done.push(3); }]]), /b down/);
    assert.deepEqual(done, [1, 3]);
    assert.deepEqual(await worker.run([[null, async () => ({ sent: 2 })], ['c', async () => 4]]), { sent: 2, c: 4 });
  } finally { console.error = original; }
});
