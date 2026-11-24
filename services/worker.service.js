// Periodic work. One failing step must not stop the rest; the caller still gets an error so it is noticed.
const STEPS = [
  [null, () => require('./subscription.service').retryPendingConfirmations()],
  ['paymentNotices', () => require('./membership-payment-alert.service').retry()],
  ['passwordNotices', () => require('./password-change-notification.service').retry()],
  ['pushNotices', () => require('./push-notifications.service').retry()],
  ['pushAutomations', () => require('./push-automations.service').run()],
  ['pushCampaigns', () => require('./push-campaigns.service').runDue()],
  ['pushRetention', () => require('./push-retention.service').sweep()],
];

async function run(steps = STEPS) {
  const result = {};
  let failure = null;
  for (const [name, work] of steps) {
    try {
      const value = await work();
      if (name) result[name] = value; else Object.assign(result, value);
    } catch (error) {
      console.error(`[worker] ${name || 'confirmations'} failed:`, error?.code || error?.message);
      failure ||= error;
    }
  }
  if (failure) throw failure;
  return result;
}

module.exports = { run };
