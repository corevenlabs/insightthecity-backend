const db = require('../config/db');
const push = require('./push-notifications.service');
const campaigns = require('./push-campaigns.service');

// Automatic notices about content. Run by the retry worker every 10 minutes.
const ZONE = 'America/New_York';
const SEND_FROM_HOUR = 9;   // nothing automatic before 9:00 New York time
const SEND_UNTIL_HOUR = 20; // nor from 20:00
const DIGEST_FROM_HOUR = 10;
const MAX_SAVED = 300;
const MAX_REMINDERS_PER_DAY = 2;
const CANDIDATES_PER_RUN = 300;
const KINDS = ['saved_reminders', 'new_experiences'];
const SAVED_SYNC = `u.push_saved_reminders AND EXISTS (SELECT 1 FROM push_automations a WHERE a.kind='saved_reminders' AND a.enabled)
  AND EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id=u.id)`;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function newYorkHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', hourCycle: 'h23' }).format(now));
}

// Replaces the server copy of the experiences this person saved. Unknown ids are ignored.
// The copy only exists while it is needed: the automation is on, the person accepts reminders and has a device that can get them.
// Otherwise (also for older app versions that still send it) nothing is stored.
async function syncSaved(userId, body = {}) {
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length > MAX_SAVED || !ids.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id))) {
    throw fail('Lista de guardados no válida');
  }
  const unique = [...new Set(ids)];
  const needed = (await db.query(`SELECT 1 FROM users u WHERE u.id=$1 AND ${SAVED_SYNC}`, [userId])).rows.length > 0;
  if (!needed) {
    await db.query('DELETE FROM saved_experiences WHERE user_id=$1', [userId]);
    return { saved: 0 };
  }
  await db.query('DELETE FROM saved_experiences WHERE user_id=$1 AND NOT (experience_id = ANY($2::varchar[]))', [userId, unique]);
  if (unique.length) {
    // FOR SHARE: if the person turns reminders off at the same time, their delete runs after this insert.
    await db.query(`WITH u AS (SELECT u.id FROM users u WHERE u.id=$1 AND ${SAVED_SYNC} FOR SHARE OF u)
      INSERT INTO saved_experiences(user_id, experience_id)
      SELECT u.id, e.id FROM u CROSS JOIN experiences e WHERE e.id = ANY($2::varchar[]) ON CONFLICT DO NOTHING`, [userId, unique]);
  }
  return { saved: unique.length };
}

async function settings() {
  const rows = (await db.query(`SELECT a.kind, a.enabled, a.updated_at, (SELECT name FROM admins WHERE id=a.updated_by) AS updated_by_name
    FROM push_automations a ORDER BY a.kind`)).rows;
  return Object.fromEntries(rows.map((row) => [row.kind, { enabled: row.enabled, updatedAt: row.updated_at, updatedBy: row.updated_by_name }]));
}

async function setSetting(kind, enabled, admin) {
  if (!KINDS.includes(kind)) throw fail('Automatización no válida');
  if (typeof enabled !== 'boolean') throw fail('El valor debe ser verdadero o falso');
  await db.query(`INSERT INTO push_automations(kind, enabled, updated_by, updated_at) VALUES($1,$2,$3,NOW())
    ON CONFLICT(kind) DO UPDATE SET enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, [kind, enabled, admin.id]);
  return settings();
}

const ELIGIBLE_USER = `u.is_active AND u.push_saved_reminders
  AND NOT EXISTS (SELECT 1 FROM account_deletions d WHERE d.user_id=u.id AND d.status='pending')
  AND EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id=u.id)
  AND (SELECT COUNT(*) FROM push_messages m WHERE m.user_id=u.id AND m.kind IN ('saved_ending','saved_benefit_started')
       AND m.created_at > NOW()-INTERVAL '20 hours') < ${MAX_REMINDERS_PER_DAY}`;

// Saved experiences that end (drop countdown, or the member benefit for members) within the next day.
async function savedEnding() {
  return (await db.query(`SELECT 'saved_ending' AS kind, s.user_id, e.id AS experience_id, x.end_at AS at FROM saved_experiences s
      JOIN experiences e ON e.id=s.experience_id JOIN users u ON u.id=s.user_id
      CROSS JOIN LATERAL (SELECT LEAST(e.ends_at, CASE WHEN u.is_premium THEN
        CASE e.benefit_action WHEN 'qr' THEN e.coupon_ends_at WHEN 'external' THEN e.external_benefit_ends_at END END) AS end_at) x
    WHERE e.is_published AND x.end_at BETWEEN NOW()+INTERVAL '2 hours' AND NOW()+INTERVAL '26 hours' AND ${ELIGIBLE_USER}
    ORDER BY x.end_at LIMIT ${CANDIDATES_PER_RUN}`)).rows;
}

// Member benefits of saved experiences that opened in the last 12 hours, for members who saved them before.
async function savedBenefitStarted() {
  return (await db.query(`SELECT 'saved_benefit_started' AS kind, s.user_id, e.id AS experience_id, x.start_at AS at FROM saved_experiences s
      JOIN experiences e ON e.id=s.experience_id JOIN users u ON u.id=s.user_id
      CROSS JOIN LATERAL (SELECT CASE e.benefit_action WHEN 'qr' THEN e.coupon_starts_at WHEN 'external' THEN e.external_benefit_starts_at END AS start_at) x
    WHERE e.is_published AND u.is_premium AND x.start_at BETWEEN NOW()-INTERVAL '12 hours' AND NOW()
      AND s.saved_at < x.start_at AND ${ELIGIBLE_USER}
    ORDER BY x.start_at LIMIT ${CANDIDATES_PER_RUN}`)).rows;
}

// Benefit openings first, then what ends soonest; at most MAX_REMINDERS_PER_DAY per person.
async function queueSavedReminders() {
  const candidates = [...await savedBenefitStarted(), ...await savedEnding()];
  if (!candidates.length) return 0;
  const userIds = [...new Set(candidates.map((row) => row.user_id))];
  const recent = new Map((await db.query(`SELECT user_id, COUNT(*)::int AS n FROM push_messages WHERE user_id = ANY($1)
    AND kind IN ('saved_ending','saved_benefit_started') AND created_at > NOW()-INTERVAL '20 hours' GROUP BY user_id`, [userIds])).rows
    .map((row) => [row.user_id, row.n]));
  let queued = 0;
  for (const row of candidates) {
    if ((recent.get(row.user_id) || 0) >= MAX_REMINDERS_PER_DAY) continue;
    const prefix = row.kind === 'saved_ending' ? 'saved-ending' : 'saved-start';
    const key = `${prefix}:${row.experience_id}:${row.user_id}:${new Date(row.at).getTime()}`;
    if (await push.enqueue(row.kind, row.user_id, key, row.experience_id)) {
      queued++;
      recent.set(row.user_id, (recent.get(row.user_id) || 0) + 1);
    }
  }
  return queued;
}

async function deliverQueued() {
  // Includes retries: reminders are only delivered inside the sending hours.
  const rows = (await db.query(`SELECT id FROM push_messages WHERE status='pending' AND next_attempt_at<=NOW()
    AND (locked_at IS NULL OR locked_at<NOW()-INTERVAL '10 minutes')
    AND kind IN ('saved_ending','saved_benefit_started') ORDER BY created_at LIMIT ${CANDIDATES_PER_RUN}`)).rows;
  let sent = 0;
  for (const row of rows) if (await push.deliver(row.id)) sent++;
  return sent;
}

const trim = (value, max) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

function digestCopy(items) {
  if (items.length === 1) {
    const title = trim(items[0].title, 150);
    return {
      es: { title: 'Nuevo en ITC Club', body: `${title}. Tócala para ver los detalles.` },
      en: { title: 'New on ITC Club', body: `${title}. Tap to see the details.` },
      pt: { title: 'Novo no ITC Club', body: `${title}. Toque para ver os detalhes.` },
    };
  }
  const names = items.slice(0, 2).map((item) => trim(item.title, 60));
  const more = items.length > 2;
  return {
    es: { title: `${items.length} experiencias nuevas en ITC Club`, body: trim(`${names.join(more ? ', ' : ' y ')}${more ? ' y más' : ''}. Descúbrelas en la app.`, 180) },
    en: { title: `${items.length} new experiences on ITC Club`, body: trim(`${names.join(more ? ', ' : ' and ')}${more ? ' and more' : ''}. Discover them in the app.`, 180) },
    pt: { title: `${items.length} novas experiências no ITC Club`, body: trim(`${names.join(more ? ', ' : ' e ')}${more ? ' e mais' : ''}. Descubra no app.`, 180) },
  };
}

// Once a day, a summary of experiences published since the last one, sent as a campaign
// (same opt-in, frequency limit and metrics as campaigns from the panel).
async function newExperiencesDigest() {
  const last = (await db.query(`SELECT MAX(created_at) AS at FROM push_campaigns WHERE automation='new_experiences'`)).rows[0]?.at;
  const items = (await db.query(`SELECT id, title FROM experiences
    WHERE is_published AND published_at > GREATEST(COALESCE($1::timestamptz, NOW()-INTERVAL '24 hours'), NOW()-INTERVAL '48 hours')
      AND published_at < NOW()-INTERVAL '30 minutes'
    ORDER BY published_at DESC LIMIT 20`, [last])).rows;
  if (!items.length) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date());
  const row = (await db.query(`INSERT INTO push_campaigns(name, copy, url, audience, language, status, scheduled_at, automation)
    VALUES($1,$2,$3,'all','all','scheduled',NOW(),'new_experiences') ON CONFLICT DO NOTHING RETURNING id`,
  [`Automática · Experiencias nuevas · ${today}`, digestCopy(items), items.length === 1 ? `/experience-detail?id=${items[0].id}` : '/home'])).rows[0];
  return row ? { campaign: row.id, experiences: items.length } : null;
}

async function run(now = new Date()) {
  const enabled = Object.fromEntries((await db.query('SELECT kind, enabled FROM push_automations')).rows.map((row) => [row.kind, row.enabled]));
  const hour = newYorkHour(now);
  const result = { hour, savedQueued: 0, savedSent: 0, digest: null };
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return result;
  if (enabled.saved_reminders) {
    result.savedQueued = await queueSavedReminders();
    result.savedSent = await deliverQueued();
  }
  if (enabled.new_experiences && hour >= DIGEST_FROM_HOUR) {
    result.digest = await newExperiencesDigest();
    if (result.digest) await campaigns.runDue({ campaignId: result.digest.campaign, budgetMs: 60_000 });
  }
  return result;
}

module.exports = { KINDS, SAVED_SYNC, syncSaved, settings, setSetting, run, digestCopy, newYorkHour };
