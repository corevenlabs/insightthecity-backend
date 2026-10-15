# Application security hardening — local, not deployed

## Implemented

- PostgreSQL-backed rate counters atomically shared by Cloud Run instances. Keys are HMACs, not plaintext IPs, emails or tokens. Fail closed with a generic 503 on counter storage failure; 429 and Retry-After when exhausted. Expired counters are cleaned one day after their window ends by the existing worker.
- User login: 20 attempts/account/15 minutes; staff login: 15/account/15 minutes; both also 1,000/source-IP/15 minutes. Counts include successful attempts. Registration: 1,000/source-IP/hour and 5/email/hour (generous aggregate limit while Cloud Run proxy identity needs verification). Password recovery request: 10/account/15 minutes; confirmation: 30/account/15 minutes, in addition to OTP expiry/attempt limits. New-password input is bounded to bcrypt's 72-byte limit; login still accepts legacy passwords up to 128 characters.
- Chat: authenticated user, 20 requests/minute and 300/day. Places endpoint now authenticated, 30/minute and 300/day, query 1–300 characters, outbound timeout 10 seconds and maximum response 2 MiB. Existing internal chat-to-Places calls remain behind the chat quota.
- Checkout creation 10/user/minute; portal 20/user/minute. General staff upload 100/minute; partner uploads 60/private invitation/minute; avatar upload 30/user/hour and private reads 60/user/minute. Web deletion: 60/source-IP/minute and 10/email/hour for code requests. Benefit code issuance: 20/user/minute and 300/day. Payment webhook routes remain before normal parsers/limits, preserving signature verification and provider retries.
- Password reset increments user session_version. Login tokens carry it and every authenticated request checks the database version. Existing version-zero tokens survive the schema migration; they are revoked after password reset or an administrative activation/deactivation update. Staff password invitations/reset and state changes revoke old staff tokens too. JWT verification explicitly permits HS256 only.
- General image uploads check bytes, canonicalize MIME and extension, reject SVG/HTML, support PNG/JPEG/WebP/GIF/AVIF. Existing avatars/partner files retain their narrower formats. PDF uploads require a %PDF- header. Multipart limits tightened. Direct local static access to /uploads/avatars and /uploads/guides denied; authorized download routes remain.
- Helmet security headers; CSP remains set per HTML route so existing pages are not unexpectedly blocked. Cross-Origin-Resource-Policy permits email/app images to load. COOP is not imposed globally to preserve Stripe/browser popup return flows. Browser CORS restricted to known backend/panel/site origins plus optional CORS_ALLOWED_ORIGINS. Native requests without Origin continue to work. API responses are no-store. CORS is not a replacement for authorization or protection against non-browser abuse.
- Panel: security headers and CSP, Google Fonts and HTTPS images/API still allowed, inline React styles allowed; no remote scripts/eval. Login displays throttling messages. Authentication storage/normal routes unchanged.
- Compatible backend/panel dependency updates; selected app build-tool utilities updated without changing Expo SDK or native package versions. No force upgrades.

## Proxy/IP limitation

No unverified trust-proxy configuration was enabled. req.ip follows the existing server configuration. Behind Cloud Run it may identify a shared proxy rather than each client; per-account quotas remain distinct, and IP limits are deliberately generous. Before production, verify the actual proxy chain and configure trusted hops/networks explicitly if appropriate. Do not blindly trust arbitrary X-Forwarded-For values. Application counters do not replace infrastructure DDoS protection or spending alerts.

## Dependency status and staged work

Last local audit after compatible updates: backend has no high/critical alerts but 5 moderate alerts in the Google Storage dependency chain remain (full fix proposes SDK v8). Panel production audit has no alerts; build updated and verified. App audit reduced from 44 to 38 alerts, with no critical alerts; remaining 25 high/13 moderate include Expo/Metro/native and tooling chains and need focused compatibility review. Audit severity is not proof of exploitability in this app.

Expo install --check reports recommended patch/minor alignment within SDK56. The native package versions were already below the currently recommended versions and were deliberately not changed here. Native/SDK changes require a separate update/build and testing; the check is not represented as passed. No claim of complete security or penetration testing.

MFA enrollment for staff, web token storage redesign, shortening/refreshing sessions, secret rotation, Google Cloud IAM/key restrictions, network controls, WAF, monitoring and billing alerts remain separate work. MFA was not silently made mandatory because each administrator needs enrollment/recovery and the user asked to preserve normal flows.

## Release

Run schema migrations, including database/security-hardening.sql, before deploying the new backend. Deploy updated panel with its Nginx configuration. Confirm all legitimate browser domains are included; add any additional custom domains to CORS_ALLOWED_ORIGINS. Do not publish unrelated pending email/web deletion work without authorization. Existing email assets remain public intentionally; private avatar/file routes require authentication. No production configuration was modified in this work.

## Verification

Unit tests, isolated PostgreSQL security/CRM/deletion/legal/private-avatar integration tests, panel production build, app TypeScript check and existing device-cache tests. Security tests exercise invalid credentials and throttling, distributed counters, password reset session invalidation, authenticated private images, valid/rejected uploads, and a mocked Stripe checkout without live charges or third-party calls.

Nginx runtime validation was not performed because the local Docker daemon is unavailable; the panel build passed. Validate nginx -t in the image before publication.
