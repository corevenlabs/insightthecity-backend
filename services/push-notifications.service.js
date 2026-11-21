const db = require('../config/db');

// Push notices through the Expo Push Service (it forwards to APNs and FCM).
// Messages never carry personal data: only fixed copy and an in-app route.
const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,120}\]$/;
const PLATFORMS = new Set(['ios', 'android']);
const MAX_TOKENS_PER_USER = 10;
const MAX_ATTEMPTS = 6;
const MESSAGE_TTL_HOURS = 48;
const ACCOUNT_CHANNEL = 'account';
const MEMBERSHIP = '/profile?membership=1';

const KINDS = {
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
    copy: {
      es: ['No pudimos cobrar tu membresía', 'Actualiza tu método de pago para mantener tus beneficios.'],
      en: ["We couldn't charge your membership", 'Update your payment method to keep your benefits.'],
      pt: ['Não conseguimos cobrar sua assinatura', 'Atualize sua forma de pagamento para manter seus benefícios.'],
    },
  },
  payment_action_required: {
    url: MEMBERSHIP,
    valid: (user) => !['active', 'trialing'].includes(user.subscription_status),
    copy: {
      es: ['Tu banco pide confirmar el pago', 'Confirma el pago de tu membresía para mantener tus beneficios.'],
      en: ['Your bank needs you to confirm a payment', 'Confirm your membership payment to keep your benefits.'],
      pt: ['Seu banco pede a confirmação do pagamento', 'Confirme o pagamento da sua assinatura para manter seus benefícios.'],
    },
  },
  membership_ended: {
    url: MEMBERSHIP,
    valid: (user) => user.is_premium !== true,
    copy: {
      es: ['Tu membresía ITC Club terminó', 'Puedes volver al Club cuando quieras desde la app.'],
      en: ['Your ITC Club membership has ended', 'You can rejoin the Club anytime from the app.'],
      pt: ['Sua assinatura ITC Club terminou', 'Você pode voltar ao Club quando quiser pelo app.'],
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
}

// account: membership notices (on by default). promotions: panel campaigns (separate opt-in, off by default).
async function setPreferences(userId, body = {}) {
  const sets = [], values = [userId];
  for (const key of ['account', 'promotions']) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'boolean') throw fail('La preferencia debe ser verdadera o falsa');
    values.push(body[key]);
    sets.push(key === 'account' ? `push_account_notices=$${values.length}`
      : `push_promotions=$${values.length}, push_promotions_changed_at=CASE WHEN push_promotions IS DISTINCT FROM $${values.length} THEN NOW() ELSE push_promotions_changed_at END`);
  }
  if (!sets.length) throw fail('La preferencia debe ser verdadera o falsa');
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$1`, values);
}

function render(kind, language) {
  const spec = KINDS[kind];
  const [title, body] = spec.copy[language] || spec.copy.es;
  return { title, body, data: { url: spec.url }, sound: 'default', channelId: ACCOUNT_CHANNEL, priority: 'high' };
}

async function enqueue(kind, userId, dedupeKey) {
  if (!KINDS[kind]) throw new Error(`Unknown push kind ${kind}`);
  const row = (await db.query(`INSERT INTO push_messages(user_id,kind,dedupe_key) VALUES($1,$2,$3)
    ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`, [userId, kind, dedupeKey])).rows[0];
  return row?.id ?? null;
}

// Best effort: a push problem must never break a payment webhook or a checkout confirmation.
async function notify(kind, userId, dedupeKey) {
  try {
    const id = await enqueue(kind, userId, dedupeKey);
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
    const user = (await db.query(`SELECT id, language, is_active, is_premium, subscription_status, push_account_notices FROM users
      WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM account_deletions WHERE user_id=$1 AND status='pending')`, [message.user_id])).rows[0];
    if (!user || !user.is_active) { await finish(id, 'skipped', 'account_unavailable'); return false; }
    if (user.push_account_notices === false) { await finish(id, 'skipped', 'opted_out'); return false; }
    if (!KINDS[message.kind].valid(user)) { await finish(id, 'skipped', 'stale'); return false; }
    const tokens = (await db.query('SELECT token FROM push_tokens WHERE user_id=$1', [user.id])).rows.map((row) => row.token);
    if (!tokens.length) { await finish(id, 'skipped', 'no_devices'); return false; }

    const content = render(message.kind, user.language);
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
  // Campaign recipients are sent in batches by push-campaigns.service.
  const rows = (await db.query(`SELECT id FROM push_messages WHERE status='pending' AND campaign_id IS NULL AND next_attempt_at<=NOW()
    AND (locked_at IS NULL OR locked_at<NOW()-INTERVAL '10 minutes') ORDER BY next_attempt_at LIMIT 50`)).rows;
  let sent = 0;
  for (const row of rows) if (await deliver(row.id)) sent++;
  return { checked: rows.length, sent, receipts: await checkReceipts() };
}

module.exports = { KINDS, MAX_ATTEMPTS, MESSAGE_TTL_HOURS, send, finish, postpone, validToken, registerToken, removeToken, setPreferences, render, enqueue, notify, deliver, checkReceipts, retry, setTransport };
