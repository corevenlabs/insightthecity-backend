// Deployment-only configuration. Secret values are never printed or written to the repository.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Stripe = require("stripe");
const { URL } = require("../services/partner-payment-link.service");
const project = process.env.PROJECT_ID;
const secretName = "PARTNER_STRIPE_WEBHOOK_SECRET";
const base = "https://itc-backend-1031252664334.us-east1.run.app";
function gcloud(args, input) {
  return execFileSync("gcloud", [...args, "--project", project], {
    encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
async function main() {
  if (!project || !process.env.GITHUB_ENV) throw new Error("Run only from the production deployment workflow");
  const key = gcloud(["secrets", "versions", "access", "latest", "--secret", "STRIPE_SECRET_KEY"]);
  const stripe = new Stripe(key);
  const mode = /^(sk|rk)_test_/.test(key) ? "TEST" : /^(sk|rk)_live_/.test(key) ? "LIVE" : "UNKNOWN";
  console.log(`Configured Stripe mode: ${mode}`);
  const account = await stripe.accounts.retrieve();
  console.log(`Configured Stripe account: ${account.id}; business: ${account.business_profile?.name || account.settings?.dashboard?.display_name || "not specified"}`);
  let link;
  for await (const item of stripe.paymentLinks.list({ limit: 100 })) {
    if (item.url === URL) { link = item; break; }
  }
  if (!link) throw new Error("The supplied Founding Partner link is not in the configured Stripe account/mode; account and mode are printed above");
  const items = await stripe.paymentLinks.listLineItems(link.id, { limit: 100 });
  if (!link.active || items.data.length !== 1 || items.has_more ||
      items.data[0].quantity !== 1 || items.data[0].price?.currency !== "usd" ||
      items.data[0].price?.unit_amount !== 30000 || items.data[0].price?.recurring ||
      items.data[0].adjustable_quantity?.enabled || link.allow_promotion_codes ||
      link.automatic_tax?.enabled || link.shipping_options?.length || link.optional_items?.length) {
    throw new Error("Founding Partner link must be active, single payment, USD 300, without variable quantity, discounts, extra charges or optional items");
  }
  console.log(`Founding Partner link verified: ${link.id}; ${link.livemode ? "LIVE" : "TEST"}; USD 300, one-time`);
  const url = `${base}/api/partners/payment/webhook`;
  let endpoint;
  for await (const item of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (item.url === url) { endpoint = item; break; }
  }
  if (endpoint) {
    if (endpoint.status !== "enabled" || !["checkout.session.completed", "checkout.session.async_payment_succeeded"].every(e => endpoint.enabled_events.includes(e) || endpoint.enabled_events.includes("*"))) {
      throw new Error("Existing dedicated partner webhook is disabled or missing required events");
    }
    const secret = gcloud(["secrets", "versions", "access", "latest", "--secret", secretName]);
    if (!secret.startsWith("whsec_")) throw new Error("Dedicated partner webhook signing secret is unavailable");
  } else {
    // Ensure the secret container is writable before creating an endpoint.
    try { gcloud(["secrets", "describe", secretName]); }
    catch { gcloud(["secrets", "create", secretName, "--replication-policy", "automatic"]); }
    endpoint = await stripe.webhookEndpoints.create({
      url, enabled_events: ["checkout.session.completed", "checkout.session.async_payment_succeeded"],
      description: "ITC Club Founding Partner payment link only (separate from app memberships)",
    }, { idempotencyKey: `itc-founding-webhook-${link.id}` });
    if (!endpoint.secret) throw new Error("Stripe did not return the dedicated signing secret");
    gcloud(["secrets", "versions", "add", secretName, "--data-file", "-"], endpoint.secret);
  }
  const returnUrl = `${base}/api/partners/payment/return?session_id={CHECKOUT_SESSION_ID}`;
  if (process.env.FOUNDING_FINALIZE === "true" && (link.after_completion?.type !== "redirect" || link.after_completion.redirect?.url !== returnUrl)) {
    await stripe.paymentLinks.update(link.id, {
      after_completion: { type: "redirect", redirect: { url: returnUrl } },
    });
  }
  fs.appendFileSync(process.env.GITHUB_ENV, `FOUNDING_PARTNER_PAYMENT_LINK_ID=${link.id}\n`);
  console.log("Dedicated partner configuration verified. Membership configuration unchanged.");
}
main().catch((err) => {
  // No object dumps: API and subprocess errors can contain sensitive request data.
  console.error(`Founding Partner setup failed: ${err.code || err.type || err.message?.split("\n")[0] || "configuration error"}`);
  process.exitCode = 1;
});
