const { test, after } = require('node:test');
const assert = require('node:assert/strict');
if (process.env.DB_DATABASE !== 'itc_crm_test' || process.env.DB_HOST !== '127.0.0.1') throw Error('Isolated database only');
const db = require('../config/db');
const push = require('../services/push-notifications.service');
const automations = require('../services/push-automations.service');
after(() => db.end());

const token = (name) => `ExponentPushToken[${name.padEnd(22, 'x')}]`;
// 15:00 UTC is 10:00 or 11:00 in New York: inside the sending hours.
const DAYTIME = new Date('2026-11-21T15:00:00Z');
const NIGHT = new Date('2026-11-21T05:00:00Z');

test('content automations remind saved experiences and summarize new ones', async (t) => {
  const sent = [];
  const previous = push.setTransport(async (url, body) => {
    if (/getReceipts/.test(url)) return { status: 200, data: { data: {} } };
    sent.push(...body);
    return { status: 200, data: { data: body.map((_, i) => ({ status: 'ok', id: `auto-${sent.length}-${i}` })) } };
  });
  const ids = {};
  const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString();
  try {
    await db.query("DELETE FROM push_campaigns WHERE automation IS NOT NULL");
    await db.query("DELETE FROM users WHERE email LIKE '%@push-auto.test'");
    await db.query("DELETE FROM experiences WHERE id LIKE 'auto-%'");
    await db.query("UPDATE push_automations SET enabled=FALSE");
    const admin = (await db.query("INSERT INTO admins(email,name,password_hash,role) VALUES('ops@push-auto.test','Ops','x','admin') ON CONFLICT(email) DO UPDATE SET name='Ops' RETURNING id")).rows[0];
    const experience = (id, values = {}) => db.query(`INSERT INTO experiences(id,title,category,is_published,ends_at,benefit_action,coupon_starts_at,coupon_ends_at,published_at)
      VALUES($1,$2,'EVENTO',$3,$4,$5,$6,$7,$8)`, [id, values.title || id, values.published !== false, values.ends || null, values.action || 'none', values.couponStart || null, values.couponEnd || null, values.publishedAt || null]);
    await experience('auto-drop', { title: 'Drop de vinilos', ends: hours(10), publishedAt: hours(-72) });
    await experience('auto-benefit', { title: 'Cena con 20%', action: 'qr', couponStart: hours(-1), couponEnd: hours(20), publishedAt: hours(-72) });
    await experience('auto-later', { title: 'Lejano', ends: hours(80), publishedAt: hours(-72) });
    await experience('auto-hidden', { title: 'Oculto', ends: hours(10), published: false });
    const user = async (email, values = {}) => {
      const row = (await db.query('INSERT INTO users(email,name,language,is_premium,push_saved_reminders,push_promotions) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
        [email, email.split('@')[0], values.language || 'es', !!values.premium, values.reminders !== false, !!values.promotions])).rows[0];
      await db.query("INSERT INTO push_tokens(token,user_id,platform) VALUES($1,$2,'android')", [token(email.split('@')[0]), row.id]);
      return row.id;
    };
    ids.member = await user('member@push-auto.test', { premium: true, promotions: true });
    ids.free = await user('free@push-auto.test', { language: 'en', promotions: true });
    ids.quiet = await user('quiet@push-auto.test', { reminders: false });

    await t.test('saved list sync validates input and mirrors only known experiences', async () => {
      await assert.rejects(automations.syncSaved(ids.member, { ids: 'auto-drop' }), { status: 400 });
      await assert.rejects(automations.syncSaved(ids.member, { ids: ['../etc'] }), { status: 400 });
      assert.deepEqual(await automations.syncSaved(ids.member, { ids: ['auto-drop', 'auto-benefit', 'auto-later', 'auto-hidden', 'auto-missing', 'auto-drop'] }), { saved: 5 });
      const saved = (await db.query('SELECT experience_id FROM saved_experiences WHERE user_id=$1 ORDER BY 1', [ids.member])).rows.map((r) => r.experience_id);
      assert.deepEqual(saved, ['auto-benefit', 'auto-drop', 'auto-hidden', 'auto-later']);
      await automations.syncSaved(ids.member, { ids: ['auto-drop', 'auto-benefit', 'auto-later'] });
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM saved_experiences WHERE user_id=$1', [ids.member])).rows[0].n, 3);
      // Saved before the benefit opened.
      await db.query("UPDATE saved_experiences SET saved_at=NOW()-INTERVAL '3 hours' WHERE user_id=$1", [ids.member]);
      await automations.syncSaved(ids.free, { ids: ['auto-drop', 'auto-benefit'] });
      await automations.syncSaved(ids.quiet, { ids: ['auto-drop'] });
    });

    await t.test('nothing runs while the automation is off or at night', async () => {
      assert.equal((await automations.run(DAYTIME)).savedQueued, 0);
      await automations.setSetting('saved_reminders', true, admin);
      assert.equal((await automations.run(NIGHT)).savedQueued, 0);
      assert.equal(sent.length, 0);
      await assert.rejects(automations.setSetting('everything', true, admin), { status: 400 });
    });

    await t.test('saved reminders reach the right people once, with localized copy', async () => {
      const result = await automations.run(DAYTIME);
      assert.equal(result.savedQueued, 3);
      assert.equal(result.savedSent, 3);
      const byUser = sent.map((m) => [m.to, m.title, m.data.url, m.channelId]).sort();
      assert.deepEqual(byUser.map((m) => m[0]).sort(), [token('free'), token('member'), token('member')].sort());
      const free = sent.find((m) => m.to === token('free'));
      assert.equal(free.title, 'Ending soon: Drop de vinilos');
      assert.match(free.body, /NY time/);
      assert.equal(free.data.url, '/experience-detail?id=auto-drop');
      assert.equal(free.channelId, 'saved');
      const memberTitles = sent.filter((m) => m.to === token('member')).map((m) => m.title).sort();
      // The member gets the benefit start; the drop and the benefit end are capped at two notices a day.
      assert.equal(memberTitles.length, 2);
      assert.ok(memberTitles.includes('Ya puedes usar tu beneficio'));
      sent.length = 0;
      assert.equal((await automations.run(DAYTIME)).savedQueued, 0);
      assert.equal(sent.length, 0);
    });

    await t.test('a reminder is skipped if the person unsaved it before delivery', async () => {
      await db.query("DELETE FROM push_messages WHERE user_id=$1", [ids.free]);
      await db.query("UPDATE experiences SET ends_at=$2 WHERE id=$1", ['auto-drop', hours(12)]);
      await push.enqueue('saved_ending', ids.free, 'manual-check', 'auto-drop');
      await automations.syncSaved(ids.free, { ids: [] });
      await automations.run(DAYTIME);
      const row = (await db.query("SELECT status, error_code FROM push_messages WHERE dedupe_key='manual-check'")).rows[0];
      assert.deepEqual(row, { status: 'skipped', error_code: 'stale' });
      sent.length = 0;
    });

    await t.test('new experiences are summarized once a day as a campaign for promotion opt-ins', async () => {
      await automations.setSetting('saved_reminders', false, admin);
      assert.equal((await automations.run(DAYTIME)).digest, null);
      await automations.setSetting('new_experiences', true, admin);
      assert.equal((await automations.run(DAYTIME)).digest, null);
      await experience('auto-new-1', { title: 'Jazz en Harlem', publishedAt: hours(-2) });
      await experience('auto-new-2', { title: 'Mercado navideño', publishedAt: hours(-3) });
      await experience('auto-new-3', { title: 'Recién subido', publishedAt: hours(0) });
      const result = await automations.run(DAYTIME);
      assert.equal(result.digest.experiences, 2);
      const campaign = (await db.query('SELECT * FROM push_campaigns WHERE id=$1', [result.digest.campaign])).rows[0];
      assert.equal(campaign.automation, 'new_experiences');
      assert.equal(campaign.status, 'sent');
      assert.equal(campaign.url, '/home');
      assert.equal(campaign.copy.es.title, '2 experiencias nuevas en ITC Club');
      assert.deepEqual(sent.map((m) => m.to).sort(), [token('free'), token('member')].sort());
      assert.equal(sent.find((m) => m.to === token('free')).title, '2 new experiences on ITC Club');
      sent.length = 0;
      assert.equal((await automations.run(DAYTIME)).digest, null);
    });

    await t.test('preferences and settings are exposed', async () => {
      await push.setPreferences(ids.member, { saved: false });
      assert.equal((await db.query('SELECT push_saved_reminders FROM users WHERE id=$1', [ids.member])).rows[0].push_saved_reminders, false);
      const settings = await automations.settings();
      assert.equal(settings.new_experiences.enabled, true);
      assert.equal(settings.saved_reminders.enabled, false);
      assert.equal(settings.new_experiences.updatedBy, 'Ops');
    });

    await t.test('publishing sets published_at once', async () => {
      await experience('auto-draft', { published: false });
      assert.equal((await db.query("SELECT published_at FROM experiences WHERE id='auto-draft'")).rows[0].published_at, null);
      await db.query("UPDATE experiences SET is_published=TRUE WHERE id='auto-draft'");
      const first = (await db.query("SELECT published_at FROM experiences WHERE id='auto-draft'")).rows[0].published_at;
      assert.ok(first);
      await db.query("UPDATE experiences SET is_published=FALSE WHERE id='auto-draft'");
      await db.query("UPDATE experiences SET is_published=TRUE WHERE id='auto-draft'");
      assert.equal((await db.query("SELECT published_at FROM experiences WHERE id='auto-draft'")).rows[0].published_at.getTime(), first.getTime());
    });
  } finally {
    push.setTransport(previous);
    await db.query("UPDATE push_automations SET enabled=FALSE");
    await db.query("DELETE FROM push_campaigns WHERE automation IS NOT NULL");
    await db.query("DELETE FROM users WHERE email LIKE '%@push-auto.test'");
    await db.query("DELETE FROM experiences WHERE id LIKE 'auto-%'");
  }
});
