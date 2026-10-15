# Web account deletion (local implementation, not deployed)

## URL and domain

The backend serves GET /delete-account?lang=es (also en, pt). It needs no app installation or existing session. Assets use /account-deletion-assets and /email-assets; API calls use /api/account-deletions. Nothing about the website hostname is hardcoded in the UI. PUBLIC_BASE_URL controls email asset and privacy URLs; ACCOUNT_DELETION_SUPPORT_EMAIL optionally overrides ITCClub@insightthecity.com.

A domain administrator can initially redirect insightthecity.com/delete-account to the backend URL. To keep the custom domain visible, reverse-proxy the page, both asset prefixes, the three public API endpoints, and the privacy route to the backend over HTTPS. If deploying a separate frontend instead, same-origin routing/CSP must be adapted explicitly; changing DNS alone does not create a path. No domain changes have been made.

## Workflow

1. POST /api/account-deletions/request-code: normalized email and language. Response always returns a random challenge identifier, including for nonexistent/in-progress accounts, without disclosing existence. For a registered account not already deleting, sends a branded eight-digit OTP. SMTP must be configured. Per-user database cooldown 60 seconds plus best-effort per-instance IP limit 10 public requests/minute.
2. POST /verify-code: challenge + code. HMAC stored, 15-minute expiry, maximum five wrong attempts, consumed on successful verification. Returns an opaque 64-character proof kept only in page memory. No deletion or account blocking at this step. Proof expires after five minutes.
3. POST /confirm: proof + accept=true. Locks/rechecks proof and user, atomically consumes proof, records the durable existing deletion job and blocks account. No password collected. Both in-app and web requests use the same cleanup worker and legal evidence rules. Inactive accounts can request deletion too; already-pending jobs continue without fresh challenges.
4. Browser displays requested/in progress, not completed. SMTP/provider failure cannot erase the durable request. Existing scheduled worker retries.

All public POSTs require JSON; no cookie/session authentication is used. Secret codes and proofs never go in URLs, logs, localStorage or page HTML. The page disallows framing and cross-origin scripts/connects via CSP and sends no-store/no-referrer headers. Challenges are removed with the user or one day after expiration by the retention worker.

## Emails

Shared table layout, official ITC logo, existing New York banner, black background, yellow actions and support footer, with ES/EN/PT copy:
- Verification code: explicitly says entering it does not delete the account.
- Request received: says blocked/in progress, explains retries and support after 48 hours (not a guaranteed maximum).
- Completed: sent only after Stripe, database and photo cleanup succeeds. Explains no automatic refund and exceptions for retained legal/payment records and provider backups.

Request-received delivery is best effort, retried on later worker attempts if the request is still pending; it must not block cancellation or prevent final confirmation. Final confirmation retains the existing persistent retry behavior. No unneeded name/profile data is retained just to personalize the final email. These emails apply to the common in-app/web deletion worker. No other transactional email templates are changed.

## Pending before production

Explicit publication authorization, migration database/web-account-deletion.sql, privacy policy publication and justified legal evidence retention definition, confirmation of support address if changed, live SMTP checks with a controlled test account, and publishing the resource URL in Play Console. Domain mapping is optional. This change has not been deployed or used to delete real accounts.

## Local verification

node --test tests/web-account-deletion.integration.js tests/account-deletion.integration.js (isolated itc_crm_test only), npm test, CRM regression tests, plus desktop/mobile screenshots and browser interaction with stubbed requests. Preview screenshots/HTML are in output/deletion-preview and contain synthetic data only. Browser verified no mobile horizontal overflow, explicit checkbox gating and exactly one confirm request.
