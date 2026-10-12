const crypto = require("crypto");
const R = require("./partner-rules");

const URL = "https://buy.stripe.com/cNi7sL8rIelBdFjeMd8Vi00";
function configured() { return Boolean(process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID); }
function reference(row) {
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET)
    .update(`founding-payment:${row.id}:${row.link_version}`).digest("hex").slice(0, 32);
  return `itcp_${row.id}_${signature}`;
}
function clientId(value) {
  return /^itcp_([a-f0-9-]{36})_[a-f0-9]{32}$/.exec(value || "")?.[1];
}
function checkoutUrl(row) {
  if (!configured() || row.offer !== "founding" || row.amount_cents !== 30000)
    R.fail("Enlace de Founding Partner no configurado", 409);
  const url = new global.URL(URL);
  url.searchParams.set("client_reference_id", reference(row));
  url.searchParams.set("locked_prefilled_email", row.email);
  return url.toString();
}
function isSession(session) {
  const id = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
  return configured() && id === process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID;
}
module.exports = { URL, configured, reference, clientId, checkoutUrl, isSession };
