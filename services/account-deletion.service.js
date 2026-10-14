const db = require('../config/db');
const stripe = require('./stripe.service');
const uploads = require('./uploads.service');
const mail = require('./password-reset-mail.service');
const crypto = require('crypto');
const workerToken = () => crypto.createHmac('sha256', process.env.JWT_SECRET).update('account-deletion-worker-v1').digest('hex');
async function request(userId) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const user = (await c.query('SELECT id,email,language,stripe_subscription_id,subscription_status FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
    if (!user) { await c.query('ROLLBACK'); return null; }
    const job = (await c.query(`INSERT INTO account_deletions(user_id,email,subscription_id,stripe_done,language)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *`,
    [user.id,user.email,user.stripe_subscription_id,!user.stripe_subscription_id || ['canceled','incomplete_expired'].includes(user.subscription_status),user.language || 'es'])).rows[0];
    await c.query('UPDATE users SET is_active=FALSE WHERE id=$1',[userId]);
    await c.query('COMMIT');
    return job;
  } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
async function processJob(id) {
  const c = await db.connect();
  let locked = false;
  try {
    locked = (await c.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[`delete:${id}`])).rows[0].locked;
    if (!locked) return;
    const job = (await c.query("SELECT * FROM account_deletions WHERE id=$1 AND status='pending' AND next_attempt_at<=NOW()",[id])).rows[0];
    if (!job) return;
    await c.query('UPDATE account_deletions SET attempts=attempts+1 WHERE id=$1',[id]);
    let stage='stripe';
    try {
      if (!job.stripe_done) {
        await stripe.cancelSubscriptionNow(job.subscription_id);
        await c.query('UPDATE account_deletions SET stripe_done=TRUE WHERE id=$1',[id]);
      }
      stage='data';
      if (!job.data_done) {
        await c.query('BEGIN');
        try {
          await c.query('DELETE FROM chat_messages WHERE user_id=$1',[job.user_id]);
          await c.query('DELETE FROM users WHERE id=$1',[job.user_id]);
          await c.query('UPDATE account_deletions SET data_done=TRUE WHERE id=$1',[id]);
          await c.query('COMMIT');
        } catch(e) { await c.query('ROLLBACK'); throw e; }
      }
      stage='photos';
      if (!job.photos_done) {
        await uploads.deletePrefix(`avatars/${job.user_id}`);
        await c.query('UPDATE account_deletions SET photos_done=TRUE WHERE id=$1',[id]);
      }
      stage='confirmation';
      if (!mail.isConfigured()) throw new Error('MAIL_NOT_CONFIGURED');
      await mail.send({to:[job.email],...require('./account-deletion-email').render(job.language)});
      await c.query("UPDATE account_deletions SET status='completed',completed_at=NOW(),email=NULL,user_id=NULL,subscription_id=NULL,last_error=NULL WHERE id=$1",[id]);
    } catch(e) {
      const delay = Math.min(3600, 60 * 2 ** Math.min(job.attempts,6));
      await c.query("UPDATE account_deletions SET last_error=$2,next_attempt_at=NOW()+($3::int*INTERVAL '1 second') WHERE id=$1",[id,stage,delay]);
      console.error('[account deletion pending]',id,stage);
      if (!job.alerted_at && (job.attempts>=4 || Date.now()-new Date(job.requested_at).getTime()>86400000)) {
        try {
          const recipients=(await c.query("SELECT email FROM admins WHERE is_active AND role='admin'")).rows.map(x=>x.email);
          if (!recipients.length || !mail.isConfigured()) throw new Error('NO_ALERT_RECIPIENT');
          await mail.send({to:recipients,subject:'ITC Club · Account deletion needs attention',text:`Request ${id} is pending at stage ${stage}. Review the protected account deletion endpoint. Automatic retries will continue.`});
          await c.query('UPDATE account_deletions SET alerted_at=NOW() WHERE id=$1',[id]);
        } catch { console.error('[account deletion alert pending]',id); }
      }
    }
  } finally {
    if (locked) await c.query('SELECT pg_advisory_unlock(hashtext($1))',[`delete:${id}`]);
    c.release();
  }
}
async function tick() {
  await require('./data-retention.service').sweep();
  const jobs=(await db.query("SELECT id FROM account_deletions WHERE status='pending' AND next_attempt_at<=NOW() ORDER BY next_attempt_at LIMIT 5")).rows;
  for (const job of jobs) await processJob(job.id);
  await db.query("DELETE FROM account_deletions WHERE status='completed' AND completed_at<NOW()-INTERVAL '30 days'");
}
module.exports={request,processJob,tick,workerToken};
