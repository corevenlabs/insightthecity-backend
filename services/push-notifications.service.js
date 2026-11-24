const db = require('../config/db');

// Push notices through the Expo Push Service (it forwards to APNs and FCM).
// Messages carry short copy and an in-app route: no names, e-mails or payment details.
// Reminders may include the title and date of the saved experience.
const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,120}\]$/;
const PLATFORMS = new Set(['ios', 'android']);
const MAX_TOKENS_PER_USER = 10;
const MAX_ATTEMPTS = 6;
const MESSAGE_TTL_HOURS = 48;
const ACCOUNT_CHANNEL = 'account';
const MEMBERSHIP = '/profile?membership=1';
const SAVED_CHANNEL = 'saved';
// Their key is what stops a later renewal webhook from announcing the same membership again.
const MARKED_KINDS = ['membership_active', 'membership_ended'];
// Lock screens are visible to others: payment notices only say there is something to see in the app.
const DISCREET = {
  es: ['ITC Club', 'Tienes una actualización sobre tu cuenta. Abre la app para verla.'],
  en: ['ITC Club', 'There is an update about your account. Open the app to see it.'],
  pt: ['ITC Club', 'Há uma atualização sobre sua conta. Abra o app para vê-la.'],
};
const ZONE = 'America/New_York';
const LOCALES = { es: 'es-US', en: 'en-US', pt: 'pt-BR' };
const short = (value, max) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const experienceUrl = (experience) => `/experience-detail?id=${experience.id}`;
// "sáb, 22 nov, 6:00 p. m." in New York time.
function when(date, language) {
  return new Date(date).toLocaleString(LOCALES[language] || LOCALES.es, { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
// End that matters to this person: the drop countdown, or the member benefit if they can use it.
function savedEnd(experience, user) {
  const benefitEnd = user.is_premium ? (experience.benefit_action === 'qr' ? experience.coupon_ends_at : experience.benefit_action === 'external' ? experience.external_benefit_ends_at : null) : null;
  const ends = [experience.ends_at, benefitEnd].filter(Boolean).map((value) => new Date(value).getTime());
  return ends.length ? Math.min(...ends) : null;
}
function benefitStart(experience) {
  return experience.benefit_action === 'qr' ? experience.coupon_starts_at : experience.benefit_action === 'external' ? experience.external_benefit_starts_at : null;
}

const KINDS = {
  // Reminders about an experience the person saved. They need the experience row.
  saved_ending: {
    preference: 'push_saved_reminders',
    channel: SAVED_CHANNEL,
    url: experienceUrl,
    valid: (user, experience) => {
      const end = experience && savedEnd(experience, user);
      return Boolean(experience?.is_published && experience.saved && end && end > Date.now() + 30 * 60 * 1000);
    },
    copy: (experience, language, user) => {
      const title = short(experience.title, 40);
      const until = when(savedEnd(experience, user), language);
      return {
        es: [`Termina pronto: ${title}`, `Lo guardaste en ITC Club. Disponible hasta el ${until} (hora de NY).`],
        en: [`Ending soon: ${title}`, `You saved it on ITC Club. Available until ${until} (NY time).`],
        pt: [`Termina em breve: ${title}`, `Você salvou no ITC Club. Disponível até ${until} (horário de NY).`],
      }[language];
    },
  },
  saved_benefit_started: {
    preference: 'push_saved_reminders',
    channel: SAVED_CHANNEL,
    url: experienceUrl,
    valid: (user, experience) => {
      const start = experience && benefitStart(experience);
      const end = experience && savedEnd(experience, user);
      return Boolean(user.is_premium && experience?.is_published && experience.saved && start && new Date(start).getTime() <= Date.now() && (!end || end > Date.now()));
    },
    copy: (experience, language) => {
      const title = short(experience.title, 80);
      return {
        es: ['Ya puedes usar tu beneficio', `${title}: el beneficio que guardaste ya está disponible.`],
        en: ['Your benefit is ready', `${title}: the benefit you saved is now available.`],
        pt: ['Seu benefício já está disponível', `${title}: o benefício que você salvou já está disponível.`],
      }[language];
    },
  },
  membership_active: {
    url: '/club',
    // The notice is stale if access was lost before it could be delivered.
    valid: (user) => user.is_premium === true,
    copy: {
      es: ['Tu membresía ITC Club está activa', 'Ya puedes usar tus beneficios del Club. Toca para verlos.'],
      en: ['Your ITC Club membership is active', 'Your Club benefits are ready. Tap to see them.'],
      pt: ['Sua assinatura ITC Club está ativa', 'Seus benefícios do Club já estão disponíveis. Toque para vê-los.'],
    },
  },
  payment_failed: {
    url: MEMBERSHIP,
    valid: (user) => !['active', 'trialing'].includes(user.subscription_status),
    copy: DISCREET,
  },
  payment_action_required: {
    url: MEMBERSHIP,
    valid: (user) => !['active', 'trialing'].includes(user.subscription_status),
    copy: DISCREET,
  },
  membership_ended: {
    url: MEMBERSHIP,
    valid: (user) => user.is_premium !== true,
    copy: {
      es: ['Tu membresía ITC Club terminó', 'Abre la app para ver los detalles.'],
      en: ['Your ITC Club membership has ended', 'Open the app to see the details.'],
      pt: ['Sua assinatura ITC Club terminou', 'Abra o app para ver os detalhes.'],
    },
  },
};

const fail = (message) => Object.assign(new Error(message), { status: 400 });

let transport = async (url, body) => {
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const response = await require('axios').post(url, body, { headers, timeout: 8000, validateStatus: () => true });
  return { status: response.status, data: response.data };
};
function setTransport(fn) { const previous = transport; transport = fn; return previous; }

function validToken(value) { return typeof value === 'string' && TOKEN.test(value); }

async function registerToken(userId, { token, platform } = {}) {
  if (!validToken(token)) throw fail('Token de notificaciones no válido');
  if (!PLATFORMS.has(platform)) throw fail('Plataforma no válida');
  // A device moves to whichever account signs in on it.
  await db.query(`INSERT INTO push_tokens(token,user_id,platform) VALUES($1,$2,$3)
    ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform, last_seen_at=NOW()`,
  [token, userId, platform]);
  await db.query(`DELETE FROM push_tokens WHERE user_id=$1 AND token NOT IN
    (SELECT token FROM push_tokens WHERE user_id=$1 ORDER BY last_seen_at DESC LIMIT $2)`, [userId, MAX_TOKENS_PER_USER]);
}

async function removeToken(userId, token) {
  if (!validToken(token)) throw fail('Token de notificaciones no válido');
  await db.query('DELETE FROM push_tokens WHERE token=$1 AND user_id=$2', [token, userId]);
  await dropUnusedSaved(userId);
}

// The device asked to stop, possibly without a session any more.
async function releaseToken(token) {
  if (!validToken(token)) throw fail('Token de notificaciones no válido');
  const row = (await db.query('DELETE FROM push_tokens WHERE token=$1 RETURNING user_id', [token])).rows[0];
  if (row) await dropUnusedSaved(row.user_id);
}

// Without any device there is nobody to remind.
async function dropUnusedSaved(userId) {
  await db.query('DELETE FROM saved_experiences WHERE user_id=$1 AND NOT EXISTS (SELECT 1 FROM push_tokens WHERE user_id=$1)', [userId]);
}

// account: membership notices (on by default). promotions: panel campaigns, saved: reminders (both separate opt-ins,
// off by default; every change is recorded with the version of the text the person saw).
async function setPreferences(userId, body = {}) {
  const sets = [], values = [userId], consents = [];
  const version = typeof body.textVersion === 'string' && /^[a-z0-9.-]{1,40}$/.test(body.textVersion) ? body.textVersion : null;
  for (const key of ['account', 'promotions', 'saved']) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'boolean') throw fail('La preferencia debe ser verdadera o falsa');
    values.push(body[key]);
    const value = `$${values.length}::boolean`;
    if (key === 'account') { sets.push(`push_account_notices=${value}`); continue; }
    const column = key === 'saved' ? 'push_saved_reminders' : 'push_promotions';
    sets.push(`${column}=${value}`, `${column}_changed_at=${key === 'saved' ? 'NOW()'
      : `CASE WHEN ${column} IS DISTINCT FROM ${value} THEN NOW() ELSE ${column}_changed_at END`}`);
    consents.push(`SELECT id, '${key}', ${value}, language FROM previous WHERE ${column} IS DISTINCT FROM ${value}`);
  }
  if (!sets.length) throw fail('La preferencia debe ser verdadera o falsa');
  const update = `UPDATE users SET ${sets.join(', ')} WHERE id=$1`;
  // One statement: a change and its record are saved together or not at all.
  if (!consents.length) await db.query(update, values);
  else {
    await db.query(`WITH previous AS (SELECT id, language, push_promotions, push_saved_reminders FROM users WHERE id=$1 FOR UPDATE),
      updated AS (${update} AND EXISTS (SELECT 1 FROM previous) RETURNING id)
      INSERT INTO push_consent_events(user_id, preference, granted, language, text_version)
      SELECT c.id, c.preference, c.granted, c.language, $${values.length + 1}::varchar
      FROM (${consents.join(' UNION ALL ')}) AS c(id, preference, granted, language)`, [...values, version]);
  }
  // Without reminders there is no reason to keep the server copy of what the person saved.
  if (body.saved === false) await db.query('DELETE FROM saved_experiences WHERE user_id=$1', [userId]);
}

function render(kind, language, experience = null, user = null) {
  const spec = KINDS[kind];
  const lang = ['es', 'en', 'pt'].includes(language) ? language : 'es';
  const [title, body] = typeof spec.copy === 'function' ? spec.copy(experience, lang, user || {}) : spec.copy[lang];
  const url = typeof spec.url === 'function' ? spec.url(experience) : spec.url;
  const account = !spec.channel;
  return { title, body, data: { url }, sound: 'default', channelId: spec.channel || ACCOUNT_CHANNEL, priority: account ? 'high' : 'default' };
}

async function enqueue(kind, userId, dedupeKey, experienceId = null) {
  if (!KINDS[kind]) throw new Error(`Unknown push kind ${kind}`);
  const row = (await db.query(`INSERT INTO push_messages(user_id,kind,dedupe_key,experience_id)
    SELECT $1::int, $2::varchar, $3::text, $4::varchar
    WHERE NOT EXISTS (SELECT 1 FROM push_notice_markers WHERE user_id=$1::int AND key_hash=encode(sha256(convert_to($3::text,'UTF8')),'hex'))
    ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`, [userId, kind, dedupeKey, experienceId])).rows[0];
  return row?.id ?? null;
}

// Best effort: a push problem must never break a payment webhook or a checkout confirmation.
async function notify(kind, userId, dedupeKey, experienceId = null) {
  try {
    const id = await enqueue(kind, userId, dedupeKey, experienceId);
    if (id) await deliver(id);
  } catch (error) {
    console.error('[push] Notice pending retry:', error?.code || 'PUSH_ENQUEUE_FAILED');
  }
}

async function send(messages) { return transport(SEND_URL, messages); }

async function finish(id, status, errorCode = null) {
  await db.query(`UPDATE push_messages SET status=$2, error_code=$3, locked_at=NULL,
    sent_at=CASE WHEN $2='sent' THEN NOW() ELSE sent_at END WHERE id=$1`, [id, status, errorCode]);
}

async function postpone(message, errorCode) {
  if (message.attempts >= MAX_ATTEMPTS) return finish(message.id, 'failed', errorCode);
  await db.query(`UPDATE push_messages SET locked_at=NULL, error_code=$2,
    next_attempt_at=NOW()+make_interval(secs=>LEAST(3600,60*power(2,LEAST(attempts,6)))::int) WHERE id=$1`, [message.id, errorCode]);
}

async function deliver(id) {
  const message = (await db.query(`UPDATE push_messages SET locked_at=NOW(), attempts=attempts+1 WHERE id=$1
    AND status='pending' AND next_attempt_at<=NOW() AND (locked_at IS NULL OR locked_at<NOW()-INTERVAL '10 minutes')
    RETURNING *`, [id])).rows[0];
  if (!message) return false;
  if (!KINDS[message.kind]) { await finish(id, 'skipped', 'unknown_kind'); return false; }
  try {
    if (Date.now() - new Date(message.created_at).getTime() > MESSAGE_TTL_HOURS * 3600 * 1000) { await finish(id, 'skipped', 'expired'); return false; }
    const user = (await db.query(`SELECT id, language, is_active, is_premium, subscription_status, push_account_notices, push_saved_reminders FROM users
      WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM account_deletions WHERE user_id=$1 AND status='pending')`, [message.user_id])).rows[0];
    if (!user || !user.is_active) { await finish(id, 'skipped', 'account_unavailable'); return false; }
    const spec = KINDS[message.kind];
    if (user[spec.preference || 'push_account_notices'] === false) { await finish(id, 'skipped', 'opted_out'); return false; }
    const experience = message.experience_id ? (await db.query(`SELECT e.*, EXISTS (SELECT 1 FROM saved_experiences s
      WHERE s.experience_id=e.id AND s.user_id=$2) AS saved FROM experiences e WHERE e.id=$1`, [message.experience_id, user.id])).rows[0] : null;
    if (!spec.valid(user, experience)) { await finish(id, 'skipped', 'stale'); return false; }
    const tokens = (await db.query('SELECT token FROM push_tokens WHERE user_id=$1', [user.id])).rows.map((row) => row.token);
    if (!tokens.length) { await finish(id, 'skipped', 'no_devices'); return false; }

    const content = render(message.kind, user.language, experience, user);
    const response = await transport(SEND_URL, tokens.map((to) => ({ to, ...content })));
    if (response.status === 429 || response.status >= 500 || !Array.isArray(response.data?.data)) {
      await postpone(message, `http_${response.status}`); return false;
    }
    let delivered = 0, retryable = false, lastError = null;
    for (const [index, ticket] of response.data.data.entries()) {
      const token = tokens[index];
      if (ticket?.status === 'ok' && ticket.id) {
        delivered++;
        await db.query('INSERT INTO push_tickets(id,message_id,token) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [ticket.id, id, token]);
        continue;
      }
      lastError = String(ticket?.details?.error || 'ticket_error').slice(0, 80);
      if (lastError === 'DeviceNotRegistered') await db.query('DELETE FROM push_tokens WHERE token=$1', [token]);
      if (lastError === 'MessageRateExceeded') retryable = true;
    }
    if (delivered) { await finish(id, 'sent'); return true; }
    if (retryable) { await postpone(message, lastError); return false; }
    await finish(id, 'failed', lastError); return false;
  } catch (error) {
    await postpone(message, String(error?.code || 'send_error').slice(0, 80));
    console.error('[push] Delivery pending retry:', error?.code || 'PUSH_SEND_FAILED');
    return false;
  }
}

// Expo publishes receipts within ~15 minutes and keeps them for 24 hours.
async function checkReceipts() {
  const rows = (await db.query(`SELECT id, token FROM push_tickets WHERE checked_at IS NULL
    AND created_at < NOW()-INTERVAL '15 minutes' AND created_at > NOW()-INTERVAL '23 hours'
    ORDER BY created_at LIMIT 1000`)).rows;
  let removed = 0;
  if (rows.length) {
    const response = await transport(RECEIPTS_URL, { ids: rows.map((row) => row.id) });
    if (response.status === 200 && response.data?.data && typeof response.data.data === 'object') {
      const receipts = response.data.data;
      for (const row of rows) {
        const receipt = receipts[row.id];
        if (!receipt) continue;
        if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
          removed += (await db.query('DELETE FROM push_tokens WHERE token=$1', [row.token])).rowCount;
        }
        await db.query('UPDATE push_tickets SET checked_at=NOW() WHERE id=$1', [row.id]);
      }
    }
  }
  await db.query("DELETE FROM push_tickets WHERE created_at < NOW()-INTERVAL '2 days'");
  return { checked: rows.length, removedTokens: removed };
}

async function retry() {
  // Campaign recipients are sent in batches by push-campaigns.service; saved reminders by push-automations.service.
  const rows = (await db.query(`SELECT id FROM push_messages WHERE status='pending' AND campaign_id IS NULL AND kind NOT IN ('saved_ending','saved_benefit_started') AND next_attempt_at<=NOW()
    AND (locked_at IS NULL OR locked_at<NOW()-INTERVAL '10 minutes') ORDER BY next_attempt_at LIMIT 50`)).rows;
  let sent = 0;
  for (const row of rows) if (await deliver(row.id)) sent++;
  return { checked: rows.length, sent, receipts: await checkReceipts() };
}

module.exports = { KINDS, MARKED_KINDS, savedEnd, benefitStart, MAX_ATTEMPTS, MESSAGE_TTL_HOURS, send, finish, postpone, validToken, registerToken, removeToken, releaseToken, setPreferences, render, enqueue, notify, deliver, checkReceipts, retry, setTransport };
