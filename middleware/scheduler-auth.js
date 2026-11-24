const { OAuth2Client } = require('google-auth-library');

// Cloud Scheduler signs each call with a short-lived Google identity token of this service account.
// It has no permissions in the project and no key: it only identifies the caller.
const ACCOUNT = 'itc-worker-scheduler@itc-developer-502721.iam.gserviceaccount.com';
const BASE = 'https://itc-backend-1031252664334.us-east1.run.app';
const verifier = new OAuth2Client();

// Each job has its own audience, so the token of one endpoint is useless on the other.
async function isScheduler(req, path, client = verifier) {
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (token.length > 4000 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return false;
  try {
    const claims = (await client.verifyIdToken({ idToken: token, audience: BASE + path })).getPayload();
    return claims?.email === ACCOUNT && claims.email_verified === true;
  } catch {
    return false;
  }
}

module.exports = { ACCOUNT, BASE, isScheduler };
