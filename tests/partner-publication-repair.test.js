const test = require('node:test');
const assert = require('node:assert/strict');
const { repair } = require('../scripts/repair-client-publications.cjs');
const targets = [
  { business_name: 'One', experience_id: 'one', experience_title: 'One place' },
  { business_name: 'Two', experience_id: 'two', experience_title: 'Two place' },
];
function fixture() {
  const state = {
    clients: targets.map((t, i) => ({ id: String(i), business_name: t.business_name, experience_id: null, deleted_at: null, blocked_at: null, amount_cents: 30000, activated_at: null, expires_at: null, owner_id: 'owner', form_status: 'submitted', payment_status: 'paid', link_version: 5 })),
    experiences: targets.map(t => ({ id: t.experience_id, title: t.experience_title, is_published: true })), drafts: [], activity: [],
  };
  const queries = []; let snapshot, released = false;
  const connection = { release() { released = true; }, async query(sql, args = []) {
    queries.push(sql);
    let rows = [];
    if (sql.startsWith('BEGIN')) snapshot = structuredClone(state);
    else if (sql === 'ROLLBACK') Object.assign(state, snapshot);
    else if (sql.includes('SELECT * FROM partner_clients WHERE business_name=')) rows = state.clients.filter(c => c.business_name === args[0] && !c.deleted_at);
    else if (sql.includes('SELECT * FROM partner_clients WHERE id=')) rows = state.clients.filter(c => c.id === args[0]);
    else if (sql.startsWith('SELECT id,title,is_published FROM experiences')) rows = state.experiences.filter(e => e.id === args[0]);
    else if (sql.startsWith('SELECT 1 FROM partner_clients')) rows = state.clients.filter(c => c.experience_id === args[0] && c.id !== args[1] && !c.deleted_at);
    else if (sql.startsWith('SELECT 1 FROM experience_drafts WHERE experience_id')) rows = state.drafts.filter(d => d.experience_id === args[0] && d.client_id && d.client_id !== args[1]);
    else if (sql.startsWith('SELECT id,client_id FROM experience_drafts')) rows = state.drafts.filter(d => d.experience_id === args[0]);
    else if (sql.startsWith('SELECT 1 FROM experience_drafts WHERE client_id')) rows = state.drafts.filter(d => d.client_id === args[0] && d.experience_id !== args[1]);
    else if (sql.startsWith('UPDATE experience_drafts')) state.drafts.filter(d => d.experience_id === args[0] && !d.client_id).forEach(d => { d.client_id = args[1]; });
    else if (sql.startsWith('UPDATE partner_clients')) { const c = state.clients.find(c => c.id === args[0]); c.experience_id = args[1]; c.updated_at = 'now'; }
    else if (sql.startsWith('INSERT INTO partner_activity')) state.activity.push(args);
    else assert.equal(sql, 'COMMIT', `Unexpected SQL: ${sql}`);
    return { rows: structuredClone(rows), rowCount: rows.length };
  } };
  return { state, queries, get released() { return released; }, async connect() { return connection; } };
}
test('audit is read-only and returns the exact reviewed pairs', async () => {
  const db = fixture(), before = structuredClone(db.state);
  const result = await repair(db, false, targets);
  assert.equal(result.results.length, 2);
  assert.equal(db.queries[0], 'BEGIN READ ONLY');
  assert(!db.queries.some(q => /^(UPDATE|INSERT|DELETE)/.test(q)));
  assert.deepEqual(db.state, before);
  assert(db.released);
});
test('repair preserves commercial data, links existing drafts and is idempotent', async () => {
  const db = fixture(); db.state.drafts.push({ id: 'draft', experience_id: 'one', client_id: null });
  const before = structuredClone(db.state.clients);
  await repair(db, true, targets);
  assert.equal(db.state.drafts[0].client_id, '0');
  db.state.clients.forEach((c, i) => { const { experience_id, updated_at, ...rest } = c; assert.equal(experience_id, targets[i].experience_id); const { experience_id: oldLink, ...previous } = before[i]; assert.deepEqual(rest, previous); });
  assert.equal(db.state.activity.length, 2);
  const result = await repair(db, true, targets);
  assert(result.results.every(r => r.alreadyLinked));
  assert.equal(db.state.activity.length, 2);
});
test('ambiguous client names cannot be linked', async () => {
  const db = fixture(); db.state.clients.push({ ...db.state.clients[0], id: 'extra' });
  await assert.rejects(repair(db, true, targets), /Expected one client/);
});
test('a conflicting link is never overwritten', async () => {
  const db = fixture(); db.state.clients[0].experience_id = 'other';
  await assert.rejects(repair(db, true, targets), /Client linked elsewhere/);
});
test('an unpublished experience cannot be repaired as published', async () => {
  const db = fixture(); db.state.experiences[0].is_published = false;
  await assert.rejects(repair(db, false, targets), /Experience not published/);
});
test('failure on the second target rolls back the first link and its activity', async () => {
  const db = fixture(); db.state.experiences[1].title = 'Different place';
  const before = structuredClone(db.state);
  await assert.rejects(repair(db, true, targets), /Title changed/);
  assert.deepEqual(db.state, before);
  assert(db.queries.includes('ROLLBACK'));
  assert(db.released);
});
test('a draft belonging to another client stops both audit and apply', async () => {
  for (const apply of [false, true]) {
    const db = fixture(); db.state.drafts.push({ id: 'draft', experience_id: 'one', client_id: 'another' });
    await assert.rejects(repair(db, apply, targets), /(?:Draft|borrador)/i);
    assert.equal(db.state.clients[0].experience_id, null);
  }
});
test('a reviewed client identifier cannot silently resolve to another client', async () => {
  const db = fixture();
  const mapping = targets.map(t => ({ ...t, client_id: 'unexpected-client' }));
  await assert.rejects(repair(db, true, mapping), /Client identifier changed/);
  assert(db.state.clients.every(c => c.experience_id === null));
});
