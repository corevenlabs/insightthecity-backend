// Transfer encrypted CI credentials to dedicated partner secrets. Never print values.
const { execFileSync } = require('node:child_process');
const project = process.env.PROJECT_ID;
const key = process.env.PARTNER_STRIPE_DEPLOY_KEY;
const webhook = process.env.PARTNER_STRIPE_DEPLOY_WEBHOOK;
const testMode = process.env.PARTNER_PAYMENT_LINK_TEST_MODE === 'true';
if (!project || !new RegExp(`^(sk|rk)_${testMode ? 'test' : 'live'}_[A-Za-z0-9]+$`).test(key || '')) throw new Error('Missing partner key or unexpected Stripe mode');
if (!/^whsec_[A-Za-z0-9]+$/.test(webhook || '')) throw new Error('Missing partner webhook signing secret');
function run(args, input) {
  try { return execFileSync('gcloud', [...args, '--project', project], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
  catch (error) {
    const code = String(error.stderr).includes('NOT_FOUND') ? 'NOT_FOUND' : String(error.stderr).includes('PERMISSION_DENIED') ? 'PERMISSION_DENIED' : 'CONFIGURATION_ERROR';
    const safe = new Error(`Partner secret operation failed: ${code}`); safe.code = code; throw safe;
  }
}
for (const [name, value] of [['PARTNER_STRIPE_SECRET_KEY', key], ['PARTNER_STRIPE_WEBHOOK_SECRET', webhook]]) {
  try { run(['secrets', 'describe', name]); }
  catch (error) { if (error.code !== 'NOT_FOUND') throw error; run(['secrets', 'create', name, '--replication-policy', 'automatic']); }
  let existing;
  try { existing = run(['secrets', 'versions', 'access', 'latest', '--secret', name]); }
  catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
  if (existing !== value) run(['secrets', 'versions', 'add', name, '--data-file', '-'], value);
  console.log(`Dedicated partner secret configured: ${name}`);
}
