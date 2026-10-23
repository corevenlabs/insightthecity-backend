const db = require('../config/db');
const deletion = require('./account-deletion.service');
const fail = (status, message) => Object.assign(new Error(message), { status });

// The authenticated session supplies userId; never accept a target from the body.
async function requestDeletion(userId, body) {
  if (body.confirm !== true) throw fail(400, 'Confirma la eliminación de la cuenta');
  const c = await db.connect();
  let job;
  try {
    await c.query('BEGIN');
    const user = (await c.query('SELECT id,is_active FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
    if (!user?.is_active) throw fail(403, 'Cuenta no disponible');
    const identity = await c.query('SELECT 1 FROM google_auth_identities WHERE user_id=$1', [userId]);
    if (!identity.rowCount) throw fail(403, 'Esta cuenta no está vinculada con Google');
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
