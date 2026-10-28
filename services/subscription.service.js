const db = require('../config/db');
const stripeService = require('./stripe.service');
const mailer = require('./mailer.service');

// Estado de la membresía ITC Club: Stripe es la fuente de verdad y el backend
// guarda una copia en users. Nunca se activa premium sin verificar con Stripe.

// past_due conserva el acceso mientras Stripe reintenta el cobro.
const PREMIUM_STATUSES = new Set(['active', 'trialing', 'past_due']);
const SYNC_MAX_AGE_MS = 10 * 60 * 1000;

function idOf(value) {
  return typeof value === 'string' ? value : value?.id ?? null;
}

function formatMoney(amountCents, currency, language) {
  const locale = { es: 'es-US', en: 'en-US', pt: 'pt-BR' }[language] || 'en-US';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((amountCents || 0) / 100);
}

function intervalLabel(interval, language) {
  const labels = {
    es: { month: 'mes', year: 'año', week: 'semana', day: 'día' },
    en: { month: 'month', year: 'year', week: 'week', day: 'day' },
    pt: { month: 'mês', year: 'ano', week: 'semana', day: 'dia' },
  };
  return (labels[language] || labels.es)[interval] || interval;
}

// Texto de renovación automática que se muestra junto al botón de pago de Stripe.
function renewalNotice(plan, language) {
  const price = formatMoney(plan.amountCents, plan.currency, language);
  const period = intervalLabel(plan.interval, language);
  if (language === 'en') return `Your ITC Club membership renews automatically at ${price}/${period} until you cancel. Cancel anytime in the app: Profile > My membership.`;
  if (language === 'pt') return `Sua assinatura ITC Club é renovada automaticamente por ${price}/${period} até você cancelar. Cancele quando quiser no app: Perfil > Minha assinatura.`;
  return `Tu membresía ITC Club se renueva automáticamente por ${price}/${period} hasta que la canceles. Cancela cuando quieras en la app: Perfil > Mi membresía.`;
}

// Acuse de suscripción (NY GBL §527-a): términos de renovación y cómo cancelar.
function confirmationEmail(user, language) {
  return require('./membership-email.service').membershipEmail(user, 'welcome', language);
}

// Copia el estado de una suscripción de Stripe al usuario. Devuelve la fila actualizada.
async function applySubscription(userId, subscription, connection = db) {
  if(subscription.metadata?.launch_invitation_id) await require('./membership-launch.service').confirm(userId,subscription);
  const item = subscription.items?.data?.[0];
  const price = item?.price;
  // En versiones recientes de la API el fin de período vive en el item.
  const periodEnd = item?.current_period_end ?? subscription.current_period_end ?? null;
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end || subscription.cancel_at);
  const { rows } = await connection.query(
    `UPDATE users SET
       stripe_customer_id = COALESCE($2, stripe_customer_id),
       stripe_subscription_id = $3,
       stripe_billing_source = $11,
       subscription_status = $4,
       subscription_current_period_end = CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5::bigint) END,
       subscription_cancel_at_period_end = $6,
       subscription_amount_cents = $7,
       subscription_currency = $8,
       subscription_interval = $9,
       subscription_synced_at = NOW(),
       is_premium = $10
     WHERE id = $1
     RETURNING *`,
    [
      userId,
      idOf(subscription.customer),
      subscription.id,
      subscription.status,
      periodEnd,
      cancelAtPeriodEnd,
      price?.unit_amount ?? null,
      price?.currency ?? null,
      price?.recurring?.interval ?? null,
      PREMIUM_STATUSES.has(subscription.status),
      subscription.metadata?.launch_invitation_id?'campaign':'normal',
    ]
  );
  return rows[0] || null;
}

// Envía el acuse una sola vez por suscripción (la confirmación y el webhook pueden llegar a la vez).
async function sendConfirmationOnce(user) {
  if (!user?.stripe_subscription_id || !PREMIUM_STATUSES.has(user.subscription_status)) return false;
  if (!mailer.isConfigured()) return false;
  const claimed = await db.query(
    `UPDATE users SET subscription_confirmation_sent_for=$2, subscription_confirmation_claimed_at=NOW(),
      subscription_confirmation_attempts=subscription_confirmation_attempts+1
     WHERE id=$1 AND is_active=true
      AND (subscription_confirmation_retry_at IS NULL OR subscription_confirmation_retry_at<=NOW())
      AND (subscription_confirmation_sent_for IS DISTINCT FROM $2
       OR subscription_confirmation_claimed_at<NOW()-INTERVAL '10 minutes')
     RETURNING id`, [user.id,user.stripe_subscription_id]);
  if (!claimed.rowCount) return false;
  try {
    await mailer.sendEmail({to:user.email,...confirmationEmail(user,user.language||'es')});
    await db.query(`UPDATE users SET subscription_confirmation_claimed_at=NULL,
      subscription_confirmation_retry_at=NULL,subscription_confirmation_attempts=0
      WHERE id=$1 AND subscription_confirmation_sent_for=$2`,[user.id,user.stripe_subscription_id]);
    return true;
  } catch (error) {
    await db.query(`UPDATE users SET subscription_confirmation_sent_for=NULL,subscription_confirmation_claimed_at=NULL,
      subscription_confirmation_retry_at=NOW()+make_interval(secs=>LEAST(3600,60*power(2,LEAST(subscription_confirmation_attempts,6)))::int)
      WHERE id=$1 AND subscription_confirmation_sent_for=$2`,[user.id,user.stripe_subscription_id]);
    console.error('[subscription] Welcome email pending retry:',error.code||'MAIL_SEND_FAILED');
    return false;
  }
}
async function retryPendingConfirmations() {
  const {rows}=await db.query(`SELECT * FROM users WHERE is_active=true AND is_premium=true
    AND subscription_status IN ('active','trialing','past_due') AND stripe_subscription_id IS NOT NULL
    AND (subscription_confirmation_sent_for IS DISTINCT FROM stripe_subscription_id
      OR subscription_confirmation_claimed_at<NOW()-INTERVAL '10 minutes')
    AND (subscription_confirmation_retry_at IS NULL OR subscription_confirmation_retry_at<=NOW())
    ORDER BY subscription_confirmation_retry_at NULLS FIRST,id LIMIT 25`);
  let sent=0;for(const user of rows)if(await sendConfirmationOnce(user))sent++;
  return {checked:rows.length,sent};
}

// Verifica una sesión de Checkout recién completada y activa la membresía.
async function confirmCheckout(userId, sessionId, billing = stripeService) {
  const session = await billing.retrieveCheckoutSession(sessionId, { expand: ['subscription'] });
  // client_reference_id se puede fijar desde la URL de un Payment Link; la metadata solo la
  // escribe nuestro servidor al crear la sesión, así que es la que prueba a quién pertenece.
  const belongsToUser = session.mode === 'subscription'
    && session.status === 'complete'
    && String(session.client_reference_id) === String(userId)
    && session.metadata?.purchase_type === 'subscription'
    && String(session.metadata?.user_id) === String(userId);
  if (!belongsToUser || !session.subscription || typeof session.subscription === 'string') return null;
  if (String(session.subscription.metadata?.user_id) !== String(userId)) return null;
  const user = await applySubscription(userId, session.subscription);
  await sendConfirmationOnce(user);
  return user;
}

// Re-sincroniza con Stripe si la copia local es vieja. Así una cancelación o un
// cobro fallido retira el acceso aunque el webhook no esté configurado.
async function syncIfStale(userId) {
  const { rows } = await db.query(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );
  const row = rows[0];
  if (!row?.stripe_subscription_id) return;
  const age = row.subscription_synced_at ? Date.now() - new Date(row.subscription_synced_at).getTime() : Infinity;
  if (age < SYNC_MAX_AGE_MS) {
    await sendConfirmationOnce(row);
    return;
  }
  try {
    const subscription = await require('./membership-billing.service').forUser(row).retrieveSubscription(row.stripe_subscription_id);
    const updatedUser = await applySubscription(userId, subscription);
    await sendConfirmationOnce(updatedUser);
  } catch (error) {
    console.error('[subscription] No se pudo sincronizar con Stripe:', error.message);
  }
}

// Webhook: localiza al usuario por metadata o por el id de la suscripción.
// Los eventos pueden llegar tarde, reintentados o desordenados: se aplica el estado actual de la
// suscripción en Stripe, y nunca el de otra suscripción mientras la del usuario siga activa.
async function applyFromWebhook(subscription, billing = stripeService) {
  const current = await billing.retrieveSubscription(subscription.id);
  let userId = Number(current.metadata?.user_id) || null;
  if (!userId) {
    const { rows } = await db.query('SELECT id FROM users WHERE stripe_subscription_id = $1', [current.id]);
    userId = rows[0]?.id ?? null;
  }
  if (!userId) return null;
  const { rows: [existing] } = await db.query('SELECT stripe_subscription_id, subscription_status FROM users WHERE id = $1', [userId]);
  if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== current.id
    && PREMIUM_STATUSES.has(existing.subscription_status)) return null;
  const user = await applySubscription(userId, current);
  await sendConfirmationOnce(user);
  return user;
}

module.exports = {
  PREMIUM_STATUSES,
  renewalNotice,
  confirmationEmail,
  applySubscription,
  confirmCheckout,
  syncIfStale,
  applyFromWebhook,
  sendConfirmationOnce,
  retryPendingConfirmations,
};
