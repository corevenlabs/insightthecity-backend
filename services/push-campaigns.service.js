const db = require('../config/db');
const push = require('./push-notifications.service');

// Push campaigns written in the panel and sent to people who opted in to news and promotions.
const LANGUAGES = ['es', 'en', 'pt'];
const AUDIENCES = new Set(['all', 'members', 'free']);
const LANGUAGE_FILTERS = new Set(['all', ...LANGUAGES]);
const TITLE_MAX = 60;
const BODY_MAX = 180;
const NAME_MAX = 120;
const MAX_SCHEDULE_DAYS = 60;
// Nobody gets more than one campaign in this window, even if several are sent.
const FREQUENCY_HOURS = 12;
const CLAIM_SIZE = 50;
const EXPO_BATCH = 100;
const PROMOTIONS_CHANNEL = 'promotions';
const SIMPLE_ROUTES = new Set(['/home', '/club']);
const EXPERIENCE_ROUTE = /^\/experience-detail\?id=([A-Za-z0-9_-]{1,120})$/;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

async function validUrl(url) {
  if (SIMPLE_ROUTES.has(url)) return url;
  const match = typeof url === 'string' ? url.match(EXPERIENCE_ROUTE) : null;
  if (!match) throw fail('Elige a qué pantalla de la app lleva la notificación');
  const found = (await db.query('SELECT 1 FROM experiences WHERE id=$1 AND is_published', [match[1]])).rows[0];
  if (!found) throw fail('La experiencia elegida no existe o no está publicada');
  return url;
}

async function validate(input = {}) {
  const name = text(input.name).slice(0, NAME_MAX);
  if (!name) throw fail('Ponle un nombre interno a la notificación');
  const copy = {};
  for (const language of LANGUAGES) {
    const title = text(input.copy?.[language]?.title);
    const body = text(input.copy?.[language]?.body);
    if (!title && !body) continue;
    if (!title || !body) throw fail(`Completa el título y el texto en ${language.toUpperCase()} o deja ambos vacíos`);
    if (title.length > TITLE_MAX) throw fail(`El título en ${language.toUpperCase()} admite hasta ${TITLE_MAX} caracteres`);
    if (body.length > BODY_MAX) throw fail(`El texto en ${language.toUpperCase()} admite hasta ${BODY_MAX} caracteres`);
    copy[language] = { title, body };
  }
  if (!copy.es) throw fail('El título y el texto en español son obligatorios');
  const audience = input.audience ?? 'all';
  if (!AUDIENCES.has(audience)) throw fail('Audiencia no válida');
  const language = input.language ?? 'all';
  if (!LANGUAGE_FILTERS.has(language)) throw fail('Idioma no válido');
  return { name, copy, url: await validUrl(input.url), audience, language };
}

// People who would receive the campaign right now; segment and language are SQL expressions.
const eligible = (segment, language) => `FROM users u
  WHERE u.is_active AND u.push_promotions
    AND NOT EXISTS (SELECT 1 FROM account_deletions d WHERE d.user_id=u.id AND d.status='pending')
    AND EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id=u.id)
    AND (${segment}='all' OR (${segment}='members' AND u.is_premium) OR (${segment}='free' AND NOT u.is_premium))
    AND (${language}='all' OR u.language=${language})`;
const RECENTLY_NOTIFIED = `EXISTS (SELECT 1 FROM push_messages m WHERE m.user_id=u.id AND m.campaign_id IS NOT NULL
    AND m.status='sent' AND m.sent_at > NOW()-make_interval(hours=>${FREQUENCY_HOURS}))`;

async function audience({ audience: segment = 'all', language = 'all' } = {}) {
  if (!AUDIENCES.has(segment) || !LANGUAGE_FILTERS.has(language)) throw fail('Audiencia no válida');
  const row = (await db.query(`SELECT COUNT(*)::int AS eligible, COUNT(*) FILTER (WHERE NOT ${RECENTLY_NOTIFIED})::int AS available
    ${eligible('$1', '$2')}`, [segment, language])).rows[0];
  const totals = (await db.query(`SELECT COUNT(*) FILTER (WHERE push_promotions)::int AS opted_in,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id=users.id))::int AS with_devices
    FROM users WHERE is_active`)).rows[0];
  return { eligible: row.eligible, available: row.available, optedIn: totals.opted_in, withDevices: totals.with_devices, frequencyHours: FREQUENCY_HOURS };
}

const FIELDS = `c.id, c.name, c.automation, c.copy, c.url, c.audience, c.language, c.status, c.scheduled_at, c.started_at, c.finished_at,
  c.recipients, c.created_at, c.updated_at,
  (SELECT name FROM admins WHERE id=c.created_by) AS created_by_name,
  (SELECT name FROM admins WHERE id=c.scheduled_by) AS scheduled_by_name,
  (SELECT json_build_object(
     'sent', COUNT(*) FILTER (WHERE status='sent'),
     'pending', COUNT(*) FILTER (WHERE status='pending'),
     'skipped', COUNT(*) FILTER (WHERE status='skipped'),
     'failed', COUNT(*) FILTER (WHERE status='failed'))
   FROM push_messages WHERE campaign_id=c.id) AS stats,
  (SELECT COUNT(*)::int FROM push_campaign_opens WHERE campaign_id=c.id) AS opens`;

async function list() {
  return (await db.query(`SELECT ${FIELDS} FROM push_campaigns c ORDER BY COALESCE(c.scheduled_at, c.updated_at) DESC, c.id DESC LIMIT 200`)).rows;
}

async function get(id) {
  const row = (await db.query(`SELECT ${FIELDS} FROM push_campaigns c WHERE c.id=$1`, [Number(id) || 0])).rows[0];
  if (!row) throw fail('Notificación no encontrada', 404);
  return row;
}

async function create(input, admin) {
  const data = await validate(input);
  const row = (await db.query(`INSERT INTO push_campaigns(name,copy,url,audience,language,created_by,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id`, [data.name, data.copy, data.url, data.audience, data.language, admin.id])).rows[0];
  return get(row.id);
}

async function update(id, input, admin) {
  const data = await validate(input);
  const row = (await db.query(`UPDATE push_campaigns SET name=$2, copy=$3, url=$4, audience=$5, language=$6, updated_by=$7, updated_at=NOW()
    WHERE id=$1 AND status IN ('draft','scheduled') RETURNING id`,
  [Number(id) || 0, data.name, data.copy, data.url, data.audience, data.language, admin.id])).rows[0];
  if (!row) throw fail('Solo se pueden editar borradores y notificaciones programadas', 409);
  return get(row.id);
}

async function remove(id) {
  const row = (await db.query("DELETE FROM push_campaigns WHERE id=$1 AND status IN ('draft','canceled') RETURNING id", [Number(id) || 0])).rows[0];
  if (!row) throw fail('Solo se pueden eliminar borradores y notificaciones canceladas', 409);
  return { id: row.id };
}

function render(campaign, language, campaignId) {
  const { title, body } = campaign.copy[language] || campaign.copy.es;
  const data = { url: campaign.url };
  if (campaignId) data.campaign = campaignId;
  return { title, body, data, sound: 'default', channelId: PROMOTIONS_CHANNEL, priority: 'default' };
}

// Sends the unsaved form to the devices of the app account that uses the admin's e-mail.
async function testSend(input, admin) {
  const data = await validate(input);
  const user = (await db.query('SELECT id, language FROM users WHERE LOWER(email)=LOWER($1) AND is_active', [admin.email])).rows[0];
  const tokens = user ? (await db.query('SELECT token FROM push_tokens WHERE user_id=$1', [user.id])).rows.map((row) => row.token) : [];
  if (!tokens.length) throw fail('Para recibir la prueba, inicia sesión en la app con el mismo correo del panel y activa las notificaciones en Perfil.', 409);
  const language = data.copy[input.testLanguage] ? input.testLanguage : user.language;
  const content = render(data, language);
  const response = await push.send(tokens.map((to) => ({ to, ...content, title: `[Prueba] ${content.title}` })));
  if (response.status !== 200 || !Array.isArray(response.data?.data)) throw fail('El servicio de notificaciones no respondió. Intenta de nuevo.', 502);
  const devices = response.data.data.filter((ticket) => ticket?.status === 'ok').length;
  if (!devices) throw fail('Tus dispositivos no aceptaron la prueba. Abre la app y revisa que las notificaciones sigan activas.', 409);
  return { devices, language };
}

async function schedule(id, { sendAt } = {}, admin) {
  let when = null;
  if (sendAt != null) {
    when = new Date(sendAt);
    if (Number.isNaN(when.getTime())) throw fail('Fecha de envío no válida');
    if (when.getTime() < Date.now() - 60_000) throw fail('La fecha de envío ya pasó');
    if (when.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000) throw fail(`Solo se puede programar hasta ${MAX_SCHEDULE_DAYS} días antes`);
  }
  const row = (await db.query(`UPDATE push_campaigns SET status='scheduled', scheduled_at=COALESCE($2, NOW()), scheduled_by=$3, updated_at=NOW()
    WHERE id=$1 AND status IN ('draft','scheduled') RETURNING id`, [Number(id) || 0, when, admin.id])).rows[0];
  if (!row) throw fail('Esta notificación ya se envió o fue cancelada', 409);
  // "Send now" starts right away; anything left is finished by the retry worker.
  if (!when) await runDue({ campaignId: row.id, budgetMs: 20_000 });
  return get(row.id);
}

async function cancel(id) {
  const row = (await db.query(`UPDATE push_campaigns SET status='canceled', finished_at=NOW(), updated_at=NOW()
    WHERE id=$1 AND status IN ('scheduled','sending') RETURNING id`, [Number(id) || 0])).rows[0];
  if (!row) throw fail('Solo se pueden cancelar notificaciones programadas o en envío', 409);
  await db.query("UPDATE push_messages SET status='skipped', error_code='canceled', locked_at=NULL WHERE campaign_id=$1 AND status='pending'", [row.id]);
  return get(row.id);
}

// Turns a due campaign into one outbox row per recipient. One statement, so a crash cannot leave it half started.
async function start(id) {
  const row = (await db.query(`WITH c AS (
      SELECT id, audience, language FROM push_campaigns WHERE id=$1 AND status='scheduled' AND scheduled_at<=NOW() FOR UPDATE
    ), recipients AS (
      INSERT INTO push_messages(user_id, kind, dedupe_key, campaign_id)
      SELECT u.id, 'campaign', 'campaign:' || c.id || ':' || u.id, c.id
      ${eligible('c.audience', 'c.language').replace('FROM users u', 'FROM c CROSS JOIN users u')} AND NOT ${RECENTLY_NOTIFIED}
      ON CONFLICT(dedupe_key) DO NOTHING RETURNING 1
    )
    UPDATE push_campaigns p SET status='sending', started_at=NOW(), updated_at=NOW(), recipients=(SELECT COUNT(*) FROM recipients)
    FROM c WHERE p.id=c.id RETURNING p.id, p.recipients`, [id])).rows[0];
  return row || null;
}

async function claim(campaignId) {
  return (await db.query(`UPDATE push_messages SET locked_at=NOW(), attempts=attempts+1 WHERE id IN (
      SELECT id FROM push_messages WHERE campaign_id=$1 AND status='pending' AND next_attempt_at<=NOW()
        AND (locked_at IS NULL OR locked_at<NOW()-INTERVAL '10 minutes')
      ORDER BY created_at LIMIT ${CLAIM_SIZE} FOR UPDATE SKIP LOCKED)
    RETURNING *`, [campaignId])).rows;
}

// Sends one claimed batch. Returns how many recipients got it.
async function deliverBatch(campaign, messages) {
  const userIds = messages.map((message) => message.user_id);
  const users = new Map((await db.query(`SELECT u.id, u.language, u.is_active, u.push_promotions,
      EXISTS (SELECT 1 FROM account_deletions d WHERE d.user_id=u.id AND d.status='pending') AS deleting
    FROM users u WHERE u.id = ANY($1)`, [userIds])).rows.map((row) => [row.id, row]));
  const tokens = new Map();
  for (const row of (await db.query('SELECT user_id, token FROM push_tokens WHERE user_id = ANY($1)', [userIds])).rows) {
    tokens.set(row.user_id, [...(tokens.get(row.user_id) || []), row.token]);
  }

  const outgoing = [];
  for (const message of messages) {
    const user = users.get(message.user_id);
    if (Date.now() - new Date(message.created_at).getTime() > push.MESSAGE_TTL_HOURS * 3600 * 1000) { await push.finish(message.id, 'skipped', 'expired'); continue; }
    if (!user || !user.is_active || user.deleting) { await push.finish(message.id, 'skipped', 'account_unavailable'); continue; }
    // The person may have turned promotions off after the campaign started.
    if (!user.push_promotions) { await push.finish(message.id, 'skipped', 'opted_out'); continue; }
    const devices = tokens.get(user.id) || [];
    if (!devices.length) { await push.finish(message.id, 'skipped', 'no_devices'); continue; }
    const content = render(campaign, user.language, campaign.id);
    for (const to of devices) outgoing.push({ message, token: to, payload: { to, ...content } });
  }

  const outcome = new Map(messages.map((message) => [message.id, { delivered: 0, retryable: null, error: null }]));
  for (let index = 0; index < outgoing.length; index += EXPO_BATCH) {
    const chunk = outgoing.slice(index, index + EXPO_BATCH);
    let response;
    try { response = await push.send(chunk.map((item) => item.payload)); }
    catch (error) { response = { status: 0, error: String(error?.code || 'send_error').slice(0, 80) }; }
    if (response.status !== 200 || !Array.isArray(response.data?.data)) {
      const code = response.error || `http_${response.status}`;
      for (const item of chunk) outcome.get(item.message.id).retryable = code;
      continue;
    }
    for (const [position, ticket] of response.data.data.entries()) {
      const item = chunk[position];
      if (!item) continue;
      const result = outcome.get(item.message.id);
      if (ticket?.status === 'ok' && ticket.id) {
        result.delivered++;
        await db.query('INSERT INTO push_tickets(id,message_id,token) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [ticket.id, item.message.id, item.token]);
        continue;
      }
      const code = String(ticket?.details?.error || 'ticket_error').slice(0, 80);
      if (code === 'DeviceNotRegistered') await db.query('DELETE FROM push_tokens WHERE token=$1', [item.token]);
      if (code === 'MessageRateExceeded') result.retryable = code; else result.error = code;
    }
  }

  let delivered = 0;
  for (const message of messages) {
    const result = outcome.get(message.id);
    if (result.delivered) { delivered++; await push.finish(message.id, 'sent'); }
    else if (result.retryable) await push.postpone(message, result.retryable);
    else if (result.error) await push.finish(message.id, 'failed', result.error);
  }
  return delivered;
}

async function processCampaign(campaignId, deadline) {
  let sent = 0;
  while (Date.now() < deadline) {
    const campaign = (await db.query("SELECT * FROM push_campaigns WHERE id=$1 AND status='sending'", [campaignId])).rows[0];
    if (!campaign) break;
    const messages = await claim(campaignId);
    if (!messages.length) break;
    sent += await deliverBatch(campaign, messages);
  }
  await db.query(`UPDATE push_campaigns SET status='sent', finished_at=NOW(), updated_at=NOW() WHERE id=$1 AND status='sending'
    AND NOT EXISTS (SELECT 1 FROM push_messages WHERE campaign_id=$1 AND status='pending')`, [campaignId]);
  return sent;
}

// Called by the retry worker (every 10 minutes) and by "send now".
async function runDue({ campaignId = null, budgetMs = 120_000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const due = (await db.query(`SELECT id FROM push_campaigns WHERE status='scheduled' AND scheduled_at<=NOW()
    AND ($1::int IS NULL OR id=$1) ORDER BY scheduled_at LIMIT 20`, [campaignId])).rows;
  for (const row of due) await start(row.id);
  const sending = (await db.query(`SELECT id FROM push_campaigns WHERE status='sending' AND ($1::int IS NULL OR id=$1)
    ORDER BY started_at LIMIT 20`, [campaignId])).rows;
  let sent = 0;
  for (const row of sending) {
    if (Date.now() >= deadline) break;
    sent += await processCampaign(row.id, deadline);
  }
  return { started: due.length, sending: sending.length, sent };
}

// Opens are counted only for people the campaign was actually sent to.
async function recordOpen(userId, campaignId) {
  const id = Number(campaignId);
  if (!Number.isInteger(id) || id <= 0) throw fail('Campaña no válida');
  await db.query(`INSERT INTO push_campaign_opens(campaign_id, user_id)
    SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM push_messages WHERE campaign_id=$1 AND user_id=$2 AND status='sent')
    ON CONFLICT DO NOTHING`, [id, userId]);
}

module.exports = {
  TITLE_MAX, BODY_MAX, FREQUENCY_HOURS, PROMOTIONS_CHANNEL,
  validate, audience, list, get, create, update, remove, render, testSend, schedule, cancel, start, runDue, recordOpen,
};
