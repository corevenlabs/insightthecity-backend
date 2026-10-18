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


test('membership welcome uses the approved subscription copy, typography and localized banner while preserving billing details', () => {
  const message = membershipEmail({ name: 'Oswaldo', language: 'es', subscription_amount_cents: 499, subscription_currency: 'usd', subscription_interval: 'month', subscription_current_period_end: '2026-11-13T16:00:00Z' });
  assert.match(message.html, /email-assets\/itc-club-logo-v1.png/);
  assert.match(message.html, /email-assets\/membership-welcome-es-phone-v2.png/);
  assert.doesNotMatch(message.html, /email-assets\/new-york.jpg/);
  assert.match(message.html, /Hola, Oswaldo/);
  assert.match(message.html, /font-family:Arial,Helvetica,sans-serif/);
  assert.match(message.html, /YA ERES PARTE DEL CLUB/);
  assert.match(message.html, /Nueva York tiene más para ti/);
  assert.match(message.html, /Explorar mis beneficios/);
  assert.match(message.text, /Tu membresía de ITC Club ya está activa/);
  assert.match(message.html, /\$4.99 \/ mes/);
  assert.match(message.text, /13 de noviembre de 2026/);
  assert.match(message.html, /Perfil &gt; Mi membresía/);
  assert.match(message.html, /app\/benefits\?lang=es/);
  assert.match(message.html, /legal\/subscription/);
  assert.match(message.html, /legal\/privacy/);
});

test('trial welcome states no initial charge and first charge date without changing paid welcome labels', () => {
  const {membershipEmail}=require('../services/membership-email.service');
  const user={name:'Launch',language:'es',subscription_status:'trialing',subscription_current_period_end:'2026-11-15T16:00:00Z',subscription_amount_cents:499,subscription_currency:'usd',subscription_interval:'month'};
  const trial=membershipEmail(user);
  assert.match(trial.text,/Tu mes gratis de ITC Club ya está activo/);
  assert.match(trial.text,/El primer cobro será/);
  assert.match(trial.text,/4.99/);
  assert.match(membershipEmail({...user,subscription_status:'active'}).text,/Próxima renovación/);
});
