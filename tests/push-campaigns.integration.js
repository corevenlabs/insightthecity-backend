const { test, after } = require('node:test');
const assert = require('node:assert/strict');
if (process.env.DB_DATABASE !== 'itc_crm_test' || process.env.DB_HOST !== '127.0.0.1') throw Error('Isolated database only');
const db = require('../config/db');
const push = require('../services/push-notifications.service');
const campaigns = require('../services/push-campaigns.service');
after(() => db.end());

const token = (name) => `ExponentPushToken[${name.padEnd(22, 'x')}]`;
const copy = {
  es: { title: 'Nuevo en el Club', body: 'Mira lo nuevo de esta semana.' },
  en: { title: 'New in the Club', body: "See what's new this week." },
};

test('panel campaigns reach only opted-in people, respect limits and track opens', async (t) => {
  const sent = [];
  let respond = (messages) => ({ status: 200, data: { data: messages.map((_, i) => ({ status: 'ok', id: `ticket-${sent.length}-${i}` })) } });
  const previous = push.setTransport(async (url, body) => {
    if (/getReceipts/.test(url)) return { status: 200, data: { data: {} } };
    sent.push(...body);
    return respond(body);
  });
  const ids = {};
  const user = async (email, values = {}) => {
    const row = (await db.query(`INSERT INTO users(email,name,language,is_premium,push_promotions) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [email, email.split('@')[0], values.language || 'es', !!values.premium, values.promotions !== false])).rows[0];
    if (values.device !== false) await db.query("INSERT INTO push_tokens(token,user_id,platform) VALUES($1,$2,'ios')", [token(email.split('@')[0]), row.id]);
    return row.id;
  };
  try {
    await db.query("DELETE FROM users WHERE email LIKE '%@push-campaign.test'");
    await db.query("DELETE FROM admins WHERE email LIKE '%@push-campaign.test'");
    await db.query("DELETE FROM experiences WHERE id IN ('push-campaign-live','push-campaign-hidden')");
    const admin = (await db.query("INSERT INTO admins(email,name,password_hash,role) VALUES('ops@push-campaign.test','Ops','x','admin') RETURNING id,email")).rows[0];
    const stranger = { id: admin.id, email: 'nobody@push-campaign.test' };
    for (const [id, published] of [['push-campaign-live', true], ['push-campaign-hidden', false]]) {
      await db.query(`INSERT INTO experiences(id,title,category,is_published) VALUES($1,'Test','EVENTO',$2)`, [id, published]);
    }
    ids.member = await user('member@push-campaign.test', { premium: true });
    ids.free = await user('free@push-campaign.test', { language: 'en' });
    ids.silent = await user('silent@push-campaign.test', { promotions: false });
    ids.deviceless = await user('deviceless@push-campaign.test', { device: false });
    ids.deleting = await user('deleting@push-campaign.test');
    ids.ops = await user('ops@push-campaign.test', { promotions: false });
    await db.query("INSERT INTO account_deletions(user_id,status) VALUES($1,'pending')", [ids.deleting]).catch(async () => {
      // Older schemas require more columns; mark the account inactive instead so it is still excluded.
      await db.query('UPDATE users SET is_active=FALSE WHERE id=$1', [ids.deleting]);
    });
    const base = { name: 'Semana', copy, url: '/club', audience: 'all', language: 'all' };

    await t.test('copy, destination and audience are validated', async () => {
      await assert.rejects(campaigns.validate({ ...base, copy: { en: copy.en } }), /español/);
      await assert.rejects(campaigns.validate({ ...base, copy: { es: { title: 'x'.repeat(61), body: 'y' } } }), /60/);
      await assert.rejects(campaigns.validate({ ...base, copy: { ...copy, pt: { title: 'Só título' } } }), /PT/);
      await assert.rejects(campaigns.validate({ ...base, url: 'https://evil.example' }), /pantalla/);
      await assert.rejects(campaigns.validate({ ...base, url: '/experience-detail?id=push-campaign-hidden' }), /publicada/);
      await assert.rejects(campaigns.validate({ ...base, audience: 'everyone' }), /Audiencia/);
      assert.equal((await campaigns.validate({ ...base, url: '/experience-detail?id=push-campaign-live' })).url, '/experience-detail?id=push-campaign-live');
    });

    await t.test('promotions opt-in is separate and timestamped', async () => {
      await push.setPreferences(ids.silent, { promotions: true });
      let row = (await db.query('SELECT push_promotions, push_promotions_changed_at, push_account_notices FROM users WHERE id=$1', [ids.silent])).rows[0];
      assert.equal(row.push_promotions, true); assert.ok(row.push_promotions_changed_at); assert.equal(row.push_account_notices, true);
      await push.setPreferences(ids.silent, { promotions: false });
      row = (await db.query('SELECT push_promotions FROM users WHERE id=$1', [ids.silent])).rows[0];
      assert.equal(row.push_promotions, false);
      await assert.rejects(push.setPreferences(ids.silent, {}), { status: 400 });
    });

    await t.test('audience estimate counts only opted-in, active people with a device', async () => {
      assert.equal((await campaigns.audience({ audience: 'all', language: 'all' })).eligible, 2);
      assert.equal((await campaigns.audience({ audience: 'members', language: 'all' })).eligible, 1);
      assert.equal((await campaigns.audience({ audience: 'free', language: 'en' })).eligible, 1);
      assert.equal((await campaigns.audience({ audience: 'all', language: 'pt' })).eligible, 0);
    });

    await t.test('test send goes only to the admin own app account, even without the opt-in', async () => {
      await assert.rejects(campaigns.testSend(base, stranger), { status: 409 });
      const result = await campaigns.testSend({ ...base, testLanguage: 'en' }, admin);
      assert.equal(result.devices, 1);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, token('ops'));
      assert.equal(sent[0].title, '[Prueba] New in the Club');
      sent.length = 0;
      assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM push_messages WHERE kind='campaign'")).rows[0].n, 0);
    });

    let first;
    await t.test('send now delivers localized copy to each eligible device', async () => {
      first = await campaigns.create(base, admin);
      assert.equal(first.status, 'draft');
      first = await campaigns.schedule(first.id, {}, admin);
      assert.equal(first.status, 'sent');
      assert.equal(first.recipients, 2);
      assert.equal(first.stats.sent, 2);
      const byToken = Object.fromEntries(sent.map((m) => [m.to, m]));
      assert.deepEqual(Object.keys(byToken).sort(), [token('free'), token('member')].sort());
      assert.equal(byToken[token('free')].title, 'New in the Club');
      assert.equal(byToken[token('member')].title, 'Nuevo en el Club');
      assert.deepEqual(byToken[token('member')].data, { url: '/club', campaign: first.id });
      assert.equal(byToken[token('member')].channelId, 'promotions');
      await assert.rejects(campaigns.update(first.id, base, admin), { status: 409 });
      await assert.rejects(campaigns.remove(first.id), { status: 409 });
      sent.length = 0;
    });

    await t.test('opens count once and only for real recipients', async () => {
      await campaigns.recordOpen(ids.member, first.id);
      await campaigns.recordOpen(ids.member, first.id);
      await campaigns.recordOpen(ids.silent, first.id);
      await assert.rejects(campaigns.recordOpen(ids.member, 'abc'), { status: 400 });
      assert.equal((await campaigns.get(first.id)).opens, 1);
    });

    await t.test('nobody gets two campaigns within the frequency window', async () => {
      const second = await campaigns.schedule((await campaigns.create(base, admin)).id, {}, admin);
      assert.equal(second.status, 'sent');
      assert.equal(second.recipients, 0);
      assert.equal(sent.length, 0);
      await db.query("UPDATE push_messages SET sent_at=NOW()-INTERVAL '13 hours' WHERE campaign_id IS NOT NULL");
    });

    await t.test('scheduled campaigns wait for their time and can be edited until then', async () => {
      const later = new Date(Date.now() + 3600_000).toISOString();
      let scheduled = await campaigns.schedule((await campaigns.create(base, admin)).id, { sendAt: later }, admin);
      assert.equal(scheduled.status, 'scheduled');
      await assert.rejects(campaigns.schedule(scheduled.id, { sendAt: '2000-01-01T00:00:00Z' }, admin), /pasó/);
      scheduled = await campaigns.update(scheduled.id, { ...base, audience: 'members' }, admin);
      assert.equal(scheduled.status, 'scheduled');
      await campaigns.runDue();
      assert.equal(sent.length, 0);
      await db.query("UPDATE push_campaigns SET scheduled_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [scheduled.id]);
      const result = await campaigns.runDue();
      assert.equal(result.started, 1);
      assert.deepEqual(sent.map((m) => m.to), [token('member')]);
      assert.equal((await campaigns.get(scheduled.id)).status, 'sent');
      sent.length = 0;
      await db.query("UPDATE push_messages SET sent_at=NOW()-INTERVAL '13 hours' WHERE campaign_id IS NOT NULL");
    });

    await t.test('outages are retried, opt-outs are honored and dead devices are removed', async () => {
      const campaign = await campaigns.create(base, admin);
      await db.query("UPDATE push_campaigns SET status='scheduled', scheduled_at=NOW() WHERE id=$1", [campaign.id]);
      assert.equal((await campaigns.start(campaign.id)).recipients, 2);
      assert.equal(await campaigns.start(campaign.id), null);
      await push.setPreferences(ids.free, { promotions: false });
      respond = () => ({ status: 503, data: {} });
      await campaigns.runDue();
      let state = await campaigns.get(campaign.id);
      assert.equal(state.status, 'sending');
      assert.equal(state.stats.pending, 1);
      assert.equal(state.stats.skipped, 1);
      await db.query('UPDATE push_messages SET next_attempt_at=NOW() WHERE campaign_id=$1', [campaign.id]);
      respond = () => ({ status: 200, data: { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] } });
      await campaigns.runDue();
      state = await campaigns.get(campaign.id);
      assert.equal(state.status, 'sent');
      assert.equal(state.stats.failed, 1);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM push_tokens WHERE user_id=$1', [ids.member])).rows[0].n, 0);
      sent.length = 0;
    });

    await t.test('canceling stops pending recipients; drafts can be deleted', async () => {
      await db.query("INSERT INTO push_tokens(token,user_id,platform) VALUES($1,$2,'ios')", [token('member2'), ids.member]);
      await db.query("UPDATE push_messages SET sent_at=NOW()-INTERVAL '13 hours' WHERE campaign_id IS NOT NULL");
      const campaign = await campaigns.create(base, admin);
      await db.query("UPDATE push_campaigns SET status='scheduled', scheduled_at=NOW() WHERE id=$1", [campaign.id]);
      await campaigns.start(campaign.id);
      const canceled = await campaigns.cancel(campaign.id);
      assert.equal(canceled.status, 'canceled');
      assert.equal(canceled.stats.pending, 0);
      await campaigns.runDue();
      assert.equal(sent.length, 0);
      assert.deepEqual(await campaigns.remove(campaign.id), { id: campaign.id });
      const draft = await campaigns.create(base, admin);
      assert.deepEqual(await campaigns.remove(draft.id), { id: draft.id });
    });

    await t.test('account notices keep working beside campaigns', async () => {
      await db.query("UPDATE users SET is_premium=TRUE WHERE id=$1", [ids.member]);
      await push.notify('membership_active', ids.member, 'test:push-campaign:active');
      assert.equal(sent.length, 1);
      assert.equal(sent[0].channelId, 'account');
    });
  } finally {
    push.setTransport(previous);
    await db.query("DELETE FROM push_campaigns WHERE created_by IN (SELECT id FROM admins WHERE email LIKE '%@push-campaign.test')");
    await db.query("DELETE FROM users WHERE email LIKE '%@push-campaign.test'");
    await db.query("DELETE FROM admins WHERE email LIKE '%@push-campaign.test'");
    await db.query("DELETE FROM experiences WHERE id IN ('push-campaign-live','push-campaign-hidden')");
  }
});
