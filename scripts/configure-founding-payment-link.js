// Deployment-only configuration. Secret values are never printed or written to the repository.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Stripe = require("stripe");
const { URL, TEST_URLS, testMode } = require("../services/partner-payment-link.service");
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
  if (process.env.FOUNDING_PARTNER_PAYMENT_LINK_MANUAL === "true") {
    fs.appendFileSync(process.env.GITHUB_ENV, "FOUNDING_PARTNER_PAYMENT_LINK_ID=\nFOUNDING_PARTNER_SECRET_BINDINGS=\n");
    if (testMode()) console.log(`Partner TEST links enabled: Founding=${TEST_URLS.founding}; Strategic=${TEST_URLS.strategic}; confirmation remains MANUAL.`);
    console.log(`Founding Partner direct link enabled: ${URL}; payment confirmation is MANUAL. No Stripe account settings changed.`);
    return;
  }
  const returnOnly = process.env.PARTNER_TEST_RETURN_CONFIRMATION === "true";
  if (returnOnly && !testMode()) throw new Error("Return-only confirmation is restricted to sandbox trials");
  let keySecret = returnOnly ? "STRIPE_SECRET_KEY" : "PARTNER_STRIPE_SECRET_KEY";
  let key;
  try { key = gcloud(["secrets", "versions", "access", "latest", "--secret", keySecret]); }
  catch (err) {
    if (!String(err.stderr).includes("NOT_FOUND")) throw err;
    keySecret = "STRIPE_SECRET_KEY";
    key = gcloud(["secrets", "versions", "access", "latest", "--secret", keySecret]);
  }
  const stripe = new Stripe(key);
  const mode = /^(sk|rk)_test_/.test(key) ? "TEST" : /^(sk|rk)_live_/.test(key) ? "LIVE" : "UNKNOWN";
  console.log(`Configured Stripe mode: ${mode}`);
  const account = await stripe.accounts.retrieve();
  console.log(`Configured Stripe account: ${account.id}; business: ${account.business_profile?.name || account.settings?.dashboard?.display_name || "not specified"}`);
  if ((mode === "TEST") !== testMode()) throw new Error("Dedicated Stripe key does not match configured partner mode");
  const specifications = testMode() ? [
    { offer: "founding", url: TEST_URLS.founding, subtotal: 120000, percent: 75 },
    { offer: "strategic", url: TEST_URLS.strategic, subtotal: 180000, percent: 100 },
  ] : [{ offer: "founding", url: URL, subtotal: 120000, percent: 75 }];
  const links = [];
  for await (const item of stripe.paymentLinks.list({ limit: 100 })) links.push(item);
  for (const spec of specifications) {
    const approved = new global.URL(spec.url);
    spec.link = links.find(item => item.url === approved.origin + approved.pathname);
    const link = spec.link;
    if (!link) throw new Error(`Approved ${spec.offer} link not found in dedicated Stripe environment`);
    const items = await stripe.paymentLinks.listLineItems(link.id, { limit: 100 });
    if (!link.active || link.livemode !== !testMode() || items.has_more || items.data.length !== 1 ||
        items.data[0].quantity !== 1 || items.data[0].price?.currency !== "usd" ||
        items.data[0].price?.unit_amount !== spec.subtotal || items.data[0].price?.recurring ||
        items.data[0].adjustable_quantity?.enabled || !link.allow_promotion_codes ||
        link.automatic_tax?.enabled || link.shipping_options?.length || link.optional_items?.length)
      throw new Error(`Unexpected pricing or extra charges for ${spec.offer}`);
    const promotions = await stripe.promotionCodes.list({ code: approved.searchParams.get("prefilled_promo_code"), active: true, limit: 100 });
    if (promotions.data.length !== 1) throw new Error(`Missing or ambiguous ${spec.offer} promotion`);
    const promo = promotions.data[0];
    const couponRef = promo.coupon || promo.promotion?.coupon;
    const coupon = typeof couponRef === "string" ? await stripe.coupons.retrieve(couponRef) : couponRef;
    if (!coupon?.valid || coupon.percent_off !== spec.percent || coupon.amount_off ||
        promo.customer || promo.customer_account || promo.restrictions?.first_time_transaction ||
        promo.restrictions?.minimum_amount || (promo.expires_at && promo.expires_at <= Date.now()/1000) ||
        (promo.max_redemptions && promo.times_redeemed >= promo.max_redemptions) ||
        (coupon.applies_to?.products && !coupon.applies_to.products.includes(typeof items.data[0].price.product === "string" ? items.data[0].price.product : items.data[0].price.product.id)))
      throw new Error(`Invalid or restricted discount for ${spec.offer}`);
    console.log(`${spec.offer} verified: ${link.id}; ${mode}; USD ${spec.subtotal * (100-spec.percent)/10000}, one-time`);
  }
  if (!returnOnly) {
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
        description: "ITC Club partner checkout (separate from app memberships)",
      }, { idempotencyKey: `itc-partner-webhook-${specifications[0].link.id}` });
      if (!endpoint.secret) throw new Error("Stripe did not return the dedicated signing secret");
      gcloud(["secrets", "versions", "add", secretName, "--data-file", "-"], endpoint.secret);
    }
  }
  const returnUrl = `${base}/api/partners/payment/return?session_id={CHECKOUT_SESSION_ID}`;
  for (const { link } of specifications) {
    if (process.env.FOUNDING_FINALIZE === "true" && (link.after_completion?.type !== "redirect" || link.after_completion.redirect?.url !== returnUrl))
      await stripe.paymentLinks.update(link.id, { after_completion: { type: "redirect", redirect: { url: returnUrl } } });
  }
  fs.appendFileSync(process.env.GITHUB_ENV, `FOUNDING_PARTNER_PAYMENT_LINK_ID=${specifications[0].link.id}\nSTRATEGIC_PARTNER_PAYMENT_LINK_ID=${specifications.find(s => s.offer === "strategic")?.link.id || ""}\nFOUNDING_PARTNER_SECRET_BINDINGS=${returnOnly ? "" : `,PARTNER_STRIPE_WEBHOOK_SECRET=${secretName}:latest`},PARTNER_STRIPE_SECRET_KEY=${keySecret}:latest\n`);
  console.log(returnOnly ? "Sandbox confirmation enabled on verified Stripe return and invitation status refresh; no new secrets or webhook required. Membership configuration unchanged." : "Dedicated partner configuration verified. Membership configuration unchanged.");
}
main().catch((err) => {
  // No object dumps: API and subprocess errors can contain sensitive request data.
  console.error(`Founding Partner setup failed: ${err.code || err.type || err.message?.split("\n")[0] || "configuration error"}`);
  process.exitCode = 1;
});
