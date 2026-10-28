const db = require('../config/db');
const deletion = require('./account-deletion.service');
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const REAUTH = 'GOOGLE_REAUTH_REQUIRED';

// The authenticated session supplies userId; never accept a target from the body.
// Same step-up as Apple: a Google sign-in from the last 5 minutes, or a fresh Google ID token.
async function requestDeletion(userId, session, body) {
  if (body.confirm !== true) throw fail(400, 'Confirma la eliminación de la cuenta');
  const now = Math.floor(Date.now() / 1000);
  const recent = String(session?.id) === String(userId) && session.auth_provider === 'google' && Number.isInteger(session.auth_time)
    && session.auth_time <= now + 30 && session.auth_time >= now - 300 && typeof session.google_sub === 'string';
  let subject = recent ? session.google_sub : null;
  if (!recent) {
    if (!body.identityToken) throw fail(409, 'Verifica tu identidad con Google para continuar.', REAUTH);
    const claims = await require('./google-auth.service').verify(body.identityToken);
    if (!Number.isInteger(claims.iat) || claims.iat < now - 300 || claims.iat > now + 30) throw fail(401, 'Vuelve a verificar tu identidad con Google', REAUTH);
    subject = claims.sub;
  }
  const c = await db.connect();
  let job;
  try {
    await c.query('BEGIN');
    const user = (await c.query('SELECT id,is_active FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
    if (!user?.is_active) throw fail(403, 'Cuenta no disponible');
    const identity = await c.query('SELECT 1 FROM google_auth_identities WHERE user_id=$1 AND subject=$2', [userId, subject]);
    if (!identity.rowCount) throw fail(403, 'La cuenta de Google no corresponde a este perfil');
    job = await deletion.request(userId, c);
    if (!job) throw fail(409, 'No se pudo solicitar la eliminación');
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally { c.release(); }
  try { await deletion.processJob(job.id); }
  catch { console.error('[google deletion] REQUEST_QUEUED'); }
  return { deletionStatus: 'requested' };
}

module.exports = { requestDeletion };
