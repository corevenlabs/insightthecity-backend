# Commercial partner campaigns

This implementation changes the web panel and backend only. It does not require an iOS/Android binary or an OTA update. Existing regular, Founding and Strategic invitations continue through their existing handlers and retain their original prices and documents. Consumer memberships use their existing Stripe flow.

## Administrator workflow

1. Open **Campañas comerciales** and create a draft. Enter name, description, currency, normal and promotional amounts per payment, one-time payment or a fixed number of monthly installments, publication duration and its starting event.
2. Optionally enable regular monthly renewal and enter its price. The initial publication period cannot be shorter than the number of monthly installments. Initial installments start with the first confirmed payment even if the business has not sent its profile. Publication may start separately on administrator approval.
3. Paste and approve the campaign's own English terms. A draft may be saved without approved terms; activation is blocked until they exist. ITC supplies the approved commercial agreement; the software does not create legal wording automatically.
4. Edit and preview invitation, welcome, profile, receipt, payment failure/recovery, renewal and cancellation emails. Existing email layout, logo and fonts are reused. Price and renewal disclosures remain fixed outside editable copy.
5. Review amounts, total commitment and renewal; explicitly activate. The backend creates a product, normal price, automatic fixed discount and optional independent regular renewal price in the connected partner Stripe account. This does not charge or email any customer. Resource creation uses a stable revision and idempotency keys. A failed activation may be retried; invitations remain disabled until all prices are verified.
6. Create a client using the campaign selector. Send the invitation or obtain its private link. Each client saves an immutable revision, price, terms and email configuration. Pausing stops new invitations without breaking previously sent links. Editing creates a new revision; prior agreements are not silently upgraded.
7. The client accepts the specific terms, pays via Stripe, and receives the same business-information form. No coupon entry is required. The checkout is withheld if its verified price or discount differs from the agreement. A first-payment receipt and accepted-terms PDF are retained separately.
8. Review and publish through the existing client/draft approval flow. The campaign's publication dates appear in the client record, along with recorded invoices and payment status.

## Billing and renewal

- Monthly installment subscriptions have a finite Stripe schedule with `end_behavior=cancel`. The promotional coupon applies only to that campaign product. A separate regular-price schedule starts at the end of the initial publication period, so a delayed publication does not cause an early fifth installment or regular renewal.
- Signed webhooks retrieve the current Stripe invoice, verify customer, campaign revision, currency, price, discount, tax, amount, period and subscription. Events and email outbox keys prevent duplicate handling and receipts. Unknown consumer membership invoices do not query the partner Stripe account.
- A failed payment suspends a previously published profile. A database guard blocks manual republication while it is suspended. Recovery requires no other outstanding invoice and a valid initial commitment. Restoration occurs only for the same previously published record if no administrator edited it while suspended. Drafts, manually hidden records, blocked/deleted clients and ended campaigns are not republished automatically.
- A recurring worker uses the existing authenticated `/api/payment/launch/retry-emails` schedule (every ten minutes) to prepare renewal schedules, send the notice during the final 15 days and hide expired profiles. `/api/partners/campaigns/worker` is an additional protected entry point with the same worker authorization. The cutoff is evaluated on each run, not by a mobile timer.
- The administrator may record the client's requested cancellation beginning 15 days before the initial publication period ends, and subsequently during regular renewal. A not-yet-started renewal schedule is canceled; an active renewal is canceled at the end of its paid period. Initial committed installments are preserved. Direct Stripe subscription cancellations are also reconciled by webhook.
- The public customer renewal-management page is intentionally deferred. Emails direct the client to the assigned ITC contact, and an administrator performs the cancellation in the panel. Do not enable automatic renewal commercially without an operational contact and approved renewal terms.

## Deployment checklist

No production resources are created by implementing or testing these files.

1. Review the local web interface, deploy backend migration `partner-campaigns.sql` before the corresponding backend, then deploy the panel. The existing backend deployment applies migrations before replacing the service.
2. Use the existing partner Stripe secret (`PARTNER_STRIPE_SECRET_KEY`, or existing `STRIPE_SECRET_KEY` fallback). No secret is needed per product. A restricted key must permit products, prices, coupons, customers, Checkout, invoices, subscriptions and subscription schedules. Automatic Tax must be configured for this account.
3. Ensure the signed partner webhook destination includes `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.marked_uncollectible`, `invoice.voided`, `customer.subscription.updated` and `customer.subscription.deleted`. The normal-account destination supports campaigns if that is the connected account; the separate consumer campaign account is left unchanged.
4. Verify the existing scheduled worker and email credentials. The worker produces no customer mail without actual campaign agreements. Configure alerts for worker errors and pending/failed outbox entries using existing operations tools.
5. Before creating a real campaign, complete a Stripe **test-mode** purchase, failed payment, recovery, duplicate webhook and renewal/cancellation simulation using that account's Tax/webhook settings. Local automated tests use a fake Stripe API and cannot certify live account permissions, tax registration or delivery configuration. Test revisions are labeled in the panel and private invitation. Do not send test invitations as live offers.

## Local validation

```sh
node --test tests/partner-campaign.test.js tests/partner-crm.test.js tests/partner-email-consistency.test.js
# Only an isolated local PostgreSQL database named itc_crm_test:
DB_HOST=127.0.0.1 DB_PORT=55459 DB_USER=itc_campaign_test DB_DATABASE=itc_crm_test npm run db:migrate
DB_HOST=127.0.0.1 DB_PORT=55459 DB_USER=itc_campaign_test DB_DATABASE=itc_crm_test node --test tests/partner-crm.integration.js
DB_HOST=127.0.0.1 DB_PORT=55459 DB_USER=itc_campaign_test DB_DATABASE=itc_crm_test node --test tests/partner-campaign.integration.js
# In insightthecity-panel:
npm test
npm run build
```

The integration suites truncate their isolated database. Never point these commands at production. Stripe and SMTP are replaced in the campaign integration suite, and its database guard rejects nonlocal hosts or a different database name.
