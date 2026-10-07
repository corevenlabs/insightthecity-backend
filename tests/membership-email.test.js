const test = require('node:test');
const assert = require('node:assert/strict');
const { membershipEmail } = require('../services/membership-email.service');
const { appLink } = require('../controllers/app-link.controller');
const user = { name: '<img src=x onerror=alert(1)>', subscription_amount_cents: 1499, subscription_currency: 'usd', subscription_interval: 'year', subscription_current_period_end: '2026-11-07T02:00:00Z' };
test('HTML and text use real plan data, NY dates, escaped names and HTTPS links in all languages', () => {
  for (const language of ['es', 'en', 'pt']) {
    for (const kind of ['welcome', 'cancel', 'resume']) {
      const mail = membershipEmail(user, kind, language);
      assert.match(mail.html, /#FDDD56/);
      assert.doesNotMatch(mail.html, /<img src=x|#D4AF37/);
      assert.match(mail.html, /&lt;img src=x/);
      assert.match(mail.html, new RegExp(`/app/${kind === 'welcome' ? 'benefits' : 'membership'}\\?lang=${language}`));
      assert.match(mail.text, /https:\/\//);
      assert.match(mail.html, /2026/);
      if (kind !== 'cancel') assert.match(mail.html, /14[.,]99/);
    }
  }
  const canceled = membershipEmail(user, 'cancel', 'es');
  assert.match(canceled.subject, /Membresía cancelada/);
  assert.match(canceled.text, /6 de noviembre/); // NY is still Nov 6 at 02:00 UTC.
  assert.match(canceled.text, /No se realizarán nuevos cobros de renovación/);
  const noPrice = membershipEmail({}, 'welcome', 'es');
  assert.doesNotMatch(noPrice.html, /\$0\.00|Invalid Date/);
});
test('email landing page permits only fixed destinations and never exposes billing data', () => {
  let code = 200, body;
  const res = { status(value) { code = value; return this; }, set() {}, type() { return this; }, send(value) { body = value; return this; } };
  appLink({ params: { target: 'membership' }, query: { lang: '<script>' } }, res);
  assert.equal(code, 200);
  assert.match(body, /itcclub:\/\/email-entry\?target=membership/);
  assert.doesNotMatch(body, /<script>|stripe_|customer|subscription_id/);
  appLink({ params: { target: 'https://evil.example' }, query: {} }, res);
  assert.equal(code, 404);
});
