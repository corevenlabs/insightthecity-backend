const { test } = require('node:test');
const assert = require('node:assert/strict');
const { partnerContact } = require('../services/partner-contact.service');
const { render } = require('../services/partner-email.service');

test('public contact changes without mutating the admin login or another executive', () => {
  const account = { id: 1, name: 'Rafael Monrroy', email: ' RMJ.RAFAEL@gmail.com ' };
  assert.equal(partnerContact(account).email, 'rmonroy@insightthecity.com');
  assert.equal(account.email, ' RMJ.RAFAEL@gmail.com ');
  const other = { email: 'other@example.com' };
  assert.strictEqual(partnerContact(other), other);
  assert.deepEqual(partnerContact(), {});
});

test('existing queued partner emails use corporate signature and reply address', () => {
  for (const offer of ['founding', 'strategic']) {
    for (const kind of ['payment', 'invite', 'received', 'changes', 'published']) {
      const message = render(kind, {
        client: { business_name: 'Business', contact_name: 'Client', offer, category: 'partner', amount_cents: 30000 },
        owner: { name: 'Rafael Monrroy', email: 'rmj.rafael@gmail.com' },
        url: 'https://example.com/invitation', language: 'en',
      });
      assert.equal(message.replyTo, 'rmonroy@insightthecity.com');
      assert(message.html.includes('mailto:rmonroy@insightthecity.com'));
      assert(!message.html.includes('rmj.rafael@gmail.com'));
      assert(!message.text.includes('rmj.rafael@gmail.com'));
    }
  }
});
