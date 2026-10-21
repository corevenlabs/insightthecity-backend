// Read-only verification: no customers, subscriptions, payments or webhook changes.
const { execFileSync } = require('node:child_process');
const Stripe = require('stripe');
const endpointUrl = 'https://itc-backend-1031252664334.us-east1.run.app/api/payment/webhook';
const events = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required'];
function validPrice(price) {
  return price.livemode === true && price.active === true && price.unit_amount === 499 && price.currency === 'usd' && price.recurring?.interval === 'month' && price.recurring?.interval_count === 1;
}
function validEndpoint(endpoint) {
  return endpoint.url === endpointUrl && endpoint.status === 'enabled' && endpoint.livemode === true && events.every(event => endpoint.enabled_events.includes('*') || endpoint.enabled_events.includes(event));
}
module.exports = { validPrice, validEndpoint, events };
async function main() {
  const read = name => execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret', name, '--project', process.env.PROJECT_ID || 'itc-developer-502721'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const key = read('STRIPE_SECRET_KEY');
  const priceId = read('STRIPE_PRICE_ID');
  if (!key.startsWith('sk_live_')) throw Error('STRIPE_SECRET_KEY must be a live key');
  if (!priceId.startsWith('price_')) throw Error('STRIPE_PRICE_ID must be a price identifier');
  const stripe = Stripe(key);
  const price = await stripe.prices.retrieve(priceId);
  if (!validPrice(price)) {
    throw Error('Expected an active live USD 4.99 monthly price in the account of STRIPE_SECRET_KEY');
  }
  let found = false;
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (validEndpoint(endpoint)) found = true;
  }
  if (!found) throw Error('A live enabled membership webhook with all eight required events is missing');
  console.log('Verified: active live USD 4.99/month price and enabled webhook with eight required events. No charges created.');
}
if (require.main === module) main().catch(() => {
  // Stripe errors can include request details. Never log credentials or raw SDK errors.
  console.error('Live membership verification failed: check secret permissions, live key, USD 4.99 monthly price and webhook events. No charges created.');
  process.exitCode = 1;
});
