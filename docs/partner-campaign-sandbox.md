# Partner campaign sandbox

Campaigns are managed from the existing administrator panel. `/campanas` contains real campaign drafts and the **Probar sin cobros** action opens `/campanas?campaignTest=1` with isolated Stripe test data. The administrator uses the same production account; there is no separate panel or test password. No mobile build or OTA is involved.

## Resources

- Backend: `itc-campaigns-test-backend` (Cloud Run, zero minimum instances, max two).
- Frontend: existing `itc-panel`. The duplicate `itc-campaigns-test-panel` is retired after unified verification.
- Database and restricted database login: `itc_campaigns_test`, separate from the `itc` database on the existing SQL instance. No customer, agreement or account data is copied from production. The maintenance connection is used only to provision the new database/login.
- Runtime identity: `itc-campaigns-test@itc-developer-502721.iam.gserviceaccount.com`, Cloud SQL connection access, access to only the sandbox runtime secrets, and writes to the sandbox media bucket.
- Media bucket: `itc-developer-502721-campaign-tests-media`, separate from production. Images uploaded as publication media are publicly readable, matching the existing publication mechanism. Partner-form originals remain in the isolated database.
- Worker: `itc-campaigns-test-worker`, every ten minutes, existing scheduler identity and a sandbox-specific OIDC audience. Only campaign work is run on the sandbox worker.

## Credentials

Production authenticates the existing administrator and forwards only a short-lived, signed assertion to the isolated backend. That backend delegates to its own test identity; production staff tokens never leave production. Direct test login is disabled. Public test invitations include `?campaignTest=1` and remain signed with the isolated key. The gateway accepts only campaign/client/editor/upload routes, and requires production admin access for all non-public routes.

Sandbox resources use these separate secrets:

- `PARTNER_CAMPAIGNS_STRIPE_TEST_SECRET_KEY` (already supplied by the account holder).
- `PARTNER_CAMPAIGNS_TEST_WEBHOOK_SECRET` (created when the sandbox webhook is registered).
- `PARTNER_CAMPAIGNS_TEST_DB_PASSWORD`.
- `PARTNER_CAMPAIGNS_TEST_JWT_SECRET`.

Existing production keys are not replaced. A `sk_live_` key, production database/login, unapproved origin, Apple configuration or SMTP credentials cause sandbox startup to fail. Stripe balance must explicitly report `livemode=false` before provisioning proceeds.

## Notifications and payment tests

All invitation, accepted-terms, welcome, profile, publication, receipt, failure, recovery, renewal and cancellation messages use existing branding and fonts. In the sandbox they are captured in **Correos y seguimiento**, not sent to external recipients. The administrator can preview HTML, read the text version and download attached PDFs. This confirms rendering and event generation; actual email delivery still requires a separate approved SMTP test before production.

The workflow automatically registers a **sandbox-only** Stripe webhook at the isolated backend. It does not change live webhook destinations. The panel reports processed/failed campaign events and captured email counts. Stripe Tax is enabled in checkout only if that sandbox's Tax settings report active. Otherwise the panel explicitly reports pending Tax configuration and tests proceed without tax; this is not a test of production tax collection. Normal campaign checkouts retain their existing automatic tax behavior.

## Deployment

1. Deploy the reviewed backend commit using `Deploy isolated partner campaign sandbox` from `main`. Only the separate test database/service is migrated and deployed. Its panel origin is the existing administrator panel.
2. Deploy the production backend and panel. Production keeps existing Stripe secrets; campaign setup verifies the existing signed live webhook and adds campaign events without removing any existing events. Campaign deliveries are scoped so their worker does not send unrelated legacy queued messages.
3. Open **Campañas comerciales → Probar sin cobros** using the normal admin session. Create a test campaign, approve its test agreement, activate it, create a test client and open its invitation. Review captured branded mail and PDFs under **Correos y seguimiento**. Use only Stripe test cards.
4. Run `Verify unified campaign panel and retire duplicate panel`. It checks real admin access, isolated data, test invitations and frontend bundle before deleting only the duplicate frontend service. Keep the technical test backend/database for isolated tests inside the existing panel.

Test first payment, repeated notification, failed/recovered installment, publication, future renewal and cancellation. Test clocks may be used; never edit production client data to simulate time. Live activation requires Stripe Tax readiness. Existing Founding/Strategic and member payment paths are unchanged.

## Verified on 2026-11-25

The initial isolated deployment was verified before consolidating the frontend. The deployed panel includes the test API URL, test banner and mail/event inbox. Administrator login was verified. The real Stripe sandbox product, normal USD 200 price, USD 60 automatic discount and USD 140 hosted checkout were verified; the diagnostic checkout was then expired without payment. Stripe webhook destination was created automatically in the sandbox. Production backend traffic was unchanged across deployment. The scheduled campaign worker returned HTTP 200 at 18:20 UTC.

Backend deployment and checkout verification: https://github.com/corevenlabs/insightthecity-backend/actions/runs/45674096433

Panel deployment: https://github.com/corevenlabs/insightthecity-panel/actions/runs/45672803513

Remaining manual billing validation: complete a test-card payment and review the resulting first invoice, welcome receipt and publication workflow; exercise recurring payment/renewal recovery; activate and validate Stripe Tax in the sandbox (currently disabled and labeled pending in the panel); perform an explicitly approved delivery test if real SMTP sending is later enabled. No commercial partner terms or real prices are approved by the technical sample campaign.
