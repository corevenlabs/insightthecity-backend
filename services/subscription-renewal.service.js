const db = require('../config/db');
const stripe = require('./stripe.service');
const { applySubscription } = require('./subscription.service');
const mail = require('./password-reset-mail.service');

function fail(message, status = 409) {
  const error = new Error(message); error.status = status; throw error;
}

async function changeRenewal(userId, cancel) {
  const connection = await db.connect();
  let user;
  let changed = false;
  try {
    await connection.query('BEGIN');
    const { rows } = await connection.query('SELECT * FROM users WHERE id = $1 AND is_active = TRUE FOR UPDATE', [userId]);
    const account = rows[0];
    if (!account?.stripe_subscription_id || !account.stripe_customer_id) fail('No tienes una suscripción pagada para administrar.', 404);
    let subscription = await stripe.retrieveSubscription(account.stripe_subscription_id);
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    if (customerId !== account.stripe_customer_id) fail('No se pudo verificar la titularidad de la suscripción.', 403);
    if (!['active', 'trialing', 'past_due'].includes(subscription.status)) fail('Esta suscripción ya no admite cambios de renovación.');
    if (subscription.schedule) fail('Este plan tiene una programación especial. Adminístralo desde la gestión de pagos.');
    const periodEnd = subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end;
    if (!periodEnd || periodEnd <= Date.now() / 1000) fail('No se pudo confirmar el período vigente de la suscripción.');
    if (subscription.cancel_at && !subscription.cancel_at_period_end) fail('Esta suscripción tiene una cancelación programada especial.');
    changed = Boolean(subscription.cancel_at_period_end) !== cancel;
    if (changed) subscription = await stripe.setSubscriptionRenewal(subscription.id, cancel);
    if (Boolean(subscription.cancel_at_period_end) !== cancel) fail('Stripe no confirmó el cambio. Vuelve a consultar tu membresía.');
    user = await applySubscription(userId, subscription, connection);
    if (!user) fail('No se pudo sincronizar la membresía. Vuelve a consultar su estado.');
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK'); throw error;
  } finally { connection.release(); }

  let emailSent = false;
  if (changed && mail.isConfigured()) {
    const lang = ['es', 'en', 'pt'].includes(user.language) ? user.language : 'es';
    const date = new Date(user.subscription_current_period_end).toLocaleDateString({ es: 'es-US', en: 'en-US', pt: 'pt-BR' }[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/New_York' });
    const copy = {
      es: cancel ? ['Renovación cancelada · ITC Club', `Cancelaste la renovación de tu membresía. Conservas tus beneficios hasta el ${date}. Tu cuenta sigue disponible. Puedes reactivar la renovación en Perfil > Mi membresía antes de que termine el período.`] : ['Renovación reactivada · ITC Club', `La renovación automática está activa nuevamente. Tu próxima renovación será el ${date}, al precio de tu plan actual. Puedes cancelarla desde Perfil > Mi membresía.`],
      en: cancel ? ['Renewal canceled · ITC Club', `Your renewal is canceled. Your benefits remain available until ${date}. Your account remains available. You can reactivate renewal in Profile > My membership before the period ends.`] : ['Renewal reactivated · ITC Club', `Automatic renewal is active again. Your next renewal is ${date} at your current plan price. You can cancel it in Profile > My membership.`],
      pt: cancel ? ['Renovação cancelada · ITC Club', `Sua renovação foi cancelada. Seus benefícios continuam até ${date}. Sua conta continua disponível. Você pode reativar a renovação em Perfil > Minha assinatura antes do fim do período.`] : ['Renovação reativada · ITC Club', `A renovação automática está ativa novamente. A próxima renovação será em ${date}, pelo preço do plano atual. Você pode cancelar em Perfil > Minha assinatura.`],
    }[lang];
    try { await mail.send({ to: [user.email], subject: copy[0], text: copy[1] }); emailSent = true; }
    catch (error) { console.error('No se pudo enviar la confirmación de renovación:', error.code || 'MAIL_SEND_FAILED'); }
  }
  return { user, changed, emailSent };
}
module.exports = { changeRenewal };
