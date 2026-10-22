# Google native sign-in backend

POST /api/users/google/login accepts identityToken, language and, for new users, acceptLegal. Existing email accounts must confirm their ITC password before the Google subject is linked. Same-subject logins reuse the original user ID. No membership, billing or profile fields are changed. No automatic email-only linking.

GOOGLE_WEB_CLIENT_ID is the public Web OAuth client ID configured for the native SDK's server audience. The client secret is intentionally unused and must never be bundled in the app. Google-auth-library verifies signature, issuer, audience and expiry. Verified email and a subject are mandatory. Requests are IP-rate-limited. Disabled users are denied. Concurrent first logins are serialized by subject; unique constraints protect both subject and user.

Migration database/google-auth.sql only creates the identity table. It cascades on user deletion. No existing account or subscription is modified by the migration.

Validation: 129 tests passed, including forged/expired/wrong-audience credentials, required password before linking, member preservation, legal acceptance and disabled users. PostgreSQL integration was run only against local itc_crm_test and confirms uniqueness and deletion cascade. A real-device Google login remains required after native builds are installed.
