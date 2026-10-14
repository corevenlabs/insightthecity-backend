const crypto = require("crypto");
const R = require("./partner-rules");

const LIVE_URLS = {
  founding: "https://buy.stripe.com/7sYaEX6jAcdtcBf0Vn8Vi03?prefilled_promo_code=ITCFOUNDING75LIVE",
  strategic: "https://buy.stripe.com/cNiaEXazQ5P558NeMd8Vi04?prefilled_promo_code=ITCFOUNDING100LIVE",
};
const URL = LIVE_URLS.founding;
const TEST_URLS = {
  founding: "https://buy.stripe.com/test_cNi9ATf7U5184GiatRgbm01?prefilled_promo_code=ITCFOUNDING75",
  strategic: "https://buy.stripe.com/test_4gM9ATe3QalsegS31pgbm00?prefilled_promo_code=ITCSTRATEGIC100",
};
function testMode() { return process.env.PARTNER_PAYMENT_LINK_TEST_MODE === "true"; }
function strategicCheckout(row) { return (testMode() || Boolean(linkId("strategic"))) && row.offer === "strategic" && row.amount_cents === 0 && row.payment_status === "waived" && ["not_sent", "invited"].includes(row.form_status) && !row.activated_at && !row.payment_verified_at; }
const strategicTest = strategicCheckout; // Compatibility for existing integrations.
function presentation(row) { return { payment_test: testMode() && (row.offer === "founding" || row.offer === "strategic"), ...(strategicTest(row) ? { payment_method: "stripe", payment_status: "pending" } : {}) }; }
function manual() { return process.env.FOUNDING_PARTNER_PAYMENT_LINK_MANUAL === "true"; }
function configured() { return manual() || Boolean(process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID); }
function manualFor(row) { return manual() && (strategicTest(row) || (row.offer === "founding" && row.payment_method === "stripe" && row.amount_cents === 30000)); }
function reference(row) {
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET)
    .update(`founding-payment:${row.id}:${row.link_version}`).digest("hex").slice(0, 32);
  return `itcp_${row.id}_${signature}`;
}
function clientId(value) {
  return /^itcp_([a-f0-9-]{36})_[a-f0-9]{32}$/.exec(value || "")?.[1];
}
function checkoutUrl(row) {
  if (!strategicTest(row) && (!configured() || row.offer !== "founding" || row.amount_cents !== 30000))
    R.fail("Enlace de Founding Partner no configurado", 409);
  const url = new global.URL(testMode() ? TEST_URLS[row.offer] : LIVE_URLS[row.offer]);
  url.searchParams.set("client_reference_id", reference(row));
  url.searchParams.set("locked_prefilled_email", row.email);
  return url.toString();
}
function linkId(offer) { return process.env[offer === "strategic" ? "STRATEGIC_PARTNER_PAYMENT_LINK_ID" : "FOUNDING_PARTNER_PAYMENT_LINK_ID"]; }
function isSession(session, offer) {
  const id = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
  const offers = offer ? [offer] : ["founding", "strategic"];
  return !manual() && offers.some(value => Boolean(linkId(value)) && id === linkId(value));
}
module.exports = { URL, LIVE_URLS, TEST_URLS, strategicCheckout, testMode, strategicTest, presentation, manual, manualFor, configured, reference, clientId, checkoutUrl, linkId, isSession };
