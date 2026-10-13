const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../services/partner-email.service');
const base = { client: { business_name: 'Example business', contact_name: 'Rafa Monroy', offer: 'founding', category: 'partner', amount_cents: 30000 }, owner: { name: 'Executive', email: 'executive@example.com' }, url: 'https://example.com/partner#example', language: 'en' };
const strategic = { ...base, client: { ...base.client, offer: 'strategic', category: 'strategic', amount_cents: 0 } };
const normalize = (html) => html.replaceAll('Strategic Founding Partner', 'Founding Partner');
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
