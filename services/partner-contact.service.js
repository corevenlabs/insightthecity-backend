const contacts = require('../config/partner-contacts.json');

// Public business contact is separate from the administrator's sign-in email.
// Resolve again when rendering queued emails so stored payloads use current contact details.
function partnerContact(owner = {}) {
  if (!owner.email) return owner;
  const email = contacts[owner.email.trim().toLowerCase()];
  return email ? { ...owner, email } : owner;
}
module.exports = { partnerContact };
