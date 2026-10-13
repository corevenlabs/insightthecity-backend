const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../services/partner-payment-link.service");
test("Founding link references are specific to client and invitation, and use only the approved URL", () => {
  process.env.JWT_SECRET = "isolated-reference-key";
  process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID = "plink_isolated";
  try {
    const row = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", link_version: "v1", offer: "founding", amount_cents: 30000, email: "a+b@example.com" };
    const ref = L.reference(row);
    assert.equal(L.clientId(ref), row.id);
    assert.match(ref, /^[a-zA-Z0-9_-]{1,200}$/);
    assert.notEqual(ref, L.reference({ ...row, link_version: "v2" }));
    assert.notEqual(ref, L.reference({ ...row, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }));
    const url = new URL(L.checkoutUrl(row));
    assert.equal(url.origin + url.pathname, new URL(L.URL).origin + new URL(L.URL).pathname);
      assert.equal(url.searchParams.get("prefilled_promo_code"), "ITCFOUNDING75");
    assert.equal(url.searchParams.get("client_reference_id"), ref);
    assert.equal(url.searchParams.get("locked_prefilled_email"), row.email);
    assert.throws(() => L.checkoutUrl({ ...row, offer: "regular" }));
    assert.throws(() => L.checkoutUrl({ ...row, amount_cents: 120000 }));
    assert.equal(L.isSession({ payment_link: "plink_other" }), false);
    assert.equal(L.isSession({ payment_link: "plink_isolated" }), true);
    assert.equal(L.isSession({ mode: "subscription" }), false);
  } finally { delete process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID; }
});

test("temporary sandbox links keep offer, discount, reference and live rollback separate", () => {
  process.env.JWT_SECRET = "isolated-reference-key";
  process.env.FOUNDING_PARTNER_PAYMENT_LINK_MANUAL = "true";
  const row = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", link_version: "v1", offer: "founding", amount_cents: 30000, email: "test@example.com", payment_method: "stripe", payment_status: "pending", form_status: "invited" };
  try {
    process.env.PARTNER_PAYMENT_LINK_TEST_MODE = "true";
    assert.equal(new URL(L.checkoutUrl(row)).pathname, new URL(L.TEST_URLS.founding).pathname);
    const strategic = { ...row, offer: "strategic", amount_cents: 0, payment_method: "waived", payment_status: "waived" };
    assert.equal(new URL(L.checkoutUrl(strategic)).searchParams.get("prefilled_promo_code"), "ITCSTRATEGIC100");
    assert.equal(L.presentation(strategic).payment_status, "pending");
    assert.equal(L.strategicTest({...strategic, payment_verified_at: "2026-10-12"}), false);
    assert.throws(() => L.checkoutUrl({ ...strategic, amount_cents: 30000 }));
    delete process.env.PARTNER_PAYMENT_LINK_TEST_MODE;
    assert.equal(new URL(L.checkoutUrl(row)).pathname, new URL(L.URL).pathname);
    assert.equal(L.strategicTest(strategic), false);
    assert.throws(() => L.checkoutUrl(strategic));
  } finally { delete process.env.PARTNER_PAYMENT_LINK_TEST_MODE; delete process.env.FOUNDING_PARTNER_PAYMENT_LINK_MANUAL; }
});
