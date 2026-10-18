const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../services/partner-email.service');
const base = { client: { business_name: 'Example business', contact_name: 'Rafa Monroy', offer: 'founding', category: 'partner', amount_cents: 30000 }, owner: { name: 'Executive', email: 'executive@example.com' }, url: 'https://example.com/partner#example', language: 'en' };
const strategic = { ...base, client: { ...base.client, offer: 'strategic', category: 'strategic', amount_cents: 0 } };
const normalize = (html) => html.replaceAll('Strategic Founding Partner', 'Founding Partner');
test('submission acknowledgment uses approved copy, yellow business name and assigned executive', () => {
  const message = render('received', { ...base, client: { ...base.client, business_name: 'Cafe <NY>' }, language: 'es' });
  assert.equal(message.subject, 'Welcome aboard, Cafe <NY>!');
  assert(message.html.includes('Welcome aboard, <span style="color:#FDDD56">Cafe &lt;NY&gt;!</span>'));
  for (const value of ['partner-welcome-banner-v2.png', 'itc-club-logo-v1.png', 'Your profile is in our hands.', 'Your account manager will review your business details and member benefit', 'View your submission', 'Let’s make this a great partnership.', 'Your ITC Club contact', base.owner.name, base.owner.email, base.url, 'The ITC Club Team']) assert(message.html.includes(value), value);
  assert(message.text.includes('Business: Cafe <NY>\nPartner type: Founding Partner'));
  assert(message.html.includes('lang="en"'));
  assert.equal(message.replyTo, base.owner.email);
  assert(!message.html.includes('new-york.jpg'));
  assert(!message.html.includes('Questions? Contact your assigned executive.'));
});
test('Strategic follows the identical Founding email design at every client stage', () => {
  for (const kind of ['invite', 'received', 'changes', 'published']) {
    const expected = render(kind, base);
    const actual = render(kind, strategic);
    assert.equal(normalize(actual.html), expected.html, kind);
    assert.equal(actual.subject, expected.subject, kind);
  }
  const foundingInvite = render('payment', base).html;
  const strategicInvite = render('payment', strategic).html;
  const stripPricing = (html) => normalize(html).replace(/Partnership: <strong style="color:#FDDD56">Founding Partner<\/strong><br>[\s\S]*?<\/p>/, 'PARTNERSHIP_AND_PRICING');
  assert.equal(stripPricing(strategicInvite), stripPricing(foundingInvite));
  for (const value of ['<s style="color:#aaa">$1,800</s>', '100% OFF', 'Your total: <strong>$0</strong>', 'No payment is required.', 'Confirm your participation']) assert(strategicInvite.includes(value), value);
  assert(!strategicInvite.includes('Review and pay'));
  assert(foundingInvite.includes('Total investment: $300'));
});

test('corrections email preserves private form and escapes personalized executive requests', () => {
  const note = 'Please replace <script>alert(1)</script>\nUse your original photographs.';
  const message = render('changes', { ...base, note, language: 'es' });
  assert.equal(message.subject, 'Example business · Let’s put the finishing touches on your profile');
  for (const text of ['Hi Rafa,', 'Let’s show what makes your business special.', 'A few details to finish together', 'Update my business profile', 'partner-corrections-banner-v2.png', 'itc-club-logo-v1.png', 'Everything you’ve already shared is saved', 'Need a hand?', base.url]) assert(message.html.includes(text), text);
  assert(!message.html.includes('<script>'));
  assert(message.html.includes('&lt;script&gt;'));
  assert(message.text.includes(note));
  assert(message.html.includes('white-space:pre-wrap'));
  assert(message.html.includes('lang="en"'));
  assert.equal(message.replyTo, base.owner.email);
  assert(!message.html.includes('Please update your information'));
  assert(!message.html.includes('new-york.jpg'));
});
