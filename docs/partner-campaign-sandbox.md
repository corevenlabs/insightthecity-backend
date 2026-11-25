# Partner campaign sandbox

The new environment is independent of the released mobile apps and production services. Its source stays on `feat/partner-campaign-sandbox` until the campaign feature is approved for production. Only a manually dispatched sandbox workflow is installed on `main`. Installing that workflow uses a `[skip ci]` commit so the existing automatic production deployment is not triggered; the actual sandbox run is explicitly dispatched with the reviewed source commit.

## Resources

- Backend: `itc-campaigns-test-backend` (Cloud Run, zero minimum instances, max two).
- Panel: `itc-campaigns-test-panel` (Cloud Run, zero minimum instances, max two).
- Database and restricted database login: `itc_campaigns_test`, separate from the `itc` database on the existing SQL instance. No customer, agreement or account data is copied from production. The maintenance connection is used only to provision the new database/login.
- Runtime identity: `itc-campaigns-test@itc-developer-502721.iam.gserviceaccount.com`, Cloud SQL connection access, access to only the sandbox runtime secrets, and writes to the sandbox media bucket.
- Media bucket: `itc-developer-502721-campaign-tests-media`, separate from production. Images uploaded as publication media are publicly readable, matching the existing publication mechanism. Partner-form originals remain in the isolated database.
- Worker: `itc-campaigns-test-worker`, every ten minutes, existing scheduler identity and a sandbox-specific OIDC audience. Only campaign work is run on the sandbox worker.

## Credentials

The account `soporte@insightthecity.com` is created independently. The generated password is stored in Secret Manager as `PARTNER_CAMPAIGNS_TEST_ADMIN_PASSWORD`; it is never printed in workflow logs or included in the panel bundle. The provisioning workflow also uses these **new** secrets:

- `PARTNER_CAMPAIGNS_STRIPE_TEST_SECRET_KEY` (already supplied by the account holder).
- `PARTNER_CAMPAIGNS_TEST_WEBHOOK_SECRET` (created when the sandbox webhook is registered).
- `PARTNER_CAMPAIGNS_TEST_DB_PASSWORD`.
- `PARTNER_CAMPAIGNS_TEST_JWT_SECRET`.

Existing production keys are not replaced. A `sk_live_` key, production database/login, production URL, Apple configuration or SMTP credentials cause sandbox startup to fail. Stripe balance must explicitly report `livemode=false` before provisioning proceeds.

## Notifications and payment tests

All invitation, accepted-terms, welcome, profile, publication, receipt, failure, recovery, renewal and cancellation messages use existing branding and fonts. In the sandbox they are captured in **Correos y seguimiento**, not sent to external recipients. The administrator can preview HTML, read the text version and download attached PDFs. This confirms rendering and event generation; actual email delivery still requires a separate approved SMTP test before production.

The workflow automatically registers a **sandbox-only** Stripe webhook at the isolated backend. It does not change live webhook destinations. The panel reports processed/failed campaign events and captured email counts. Stripe Tax is enabled in checkout only if that sandbox's Tax settings report active. Otherwise the panel explicitly reports pending Tax configuration and tests proceed without tax; this is not a test of production tax collection. Normal campaign checkouts retain their existing automatic tax behavior.

## Deployment

1. Run `Deploy isolated partner campaign sandbox` from `main`, selecting the reviewed **backend** feature commit as `source_ref`. It validates tests, provisions named sandbox resources, migrates only `itc_campaigns_test` and deploys only the test service. A missing permission or secret fails the workflow rather than falling back to production.
2. Run `Deploy isolated campaign test panel` from the panel repository's `main`, with the reviewed **panel** feature commit. The API URL and test banner are fixed at build time to the isolated backend.
3. Open the test panel, retrieve the test administrator password directly from Secret Manager and log in. Create a campaign, approve its test agreement, activate it, create a test client and open its private invitation. Use only Stripe test cards. Review captured notifications and event statuses.
4. Test first payment, repeated notification, failed/recovered installment, publication, future renewal and cancellation. Test clocks may be used for renewal scenarios; never edit production client data to simulate time.

No EAS build, app-store submission or mobile OTA update is part of either workflow. Production rollout is a separate task after the sandbox is reviewed.
