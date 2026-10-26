const db = require('../config/db');
const mail = require('./password-reset-mail.service');
async function enqueue(c, user, version) {
  return (await c.query(`INSERT INTO password_change_notifications(user_id,session_version,recipient,language)
    VALUES($1,$2,$3,$4) ON CONFLICT(user_id,session_version) DO NOTHING RETURNING id`,
  [user.user_id,version,user.email,['es','en','pt'].includes(user.language)?user.language:'es'])).rows[0]?.id;
}
async function deliver(id) {
  if (!id || !mail.isConfigured()) return;
  const row = (await db.query(`UPDATE password_change_notifications SET status='sending',locked_at=NOW(),attempts=attempts+1
    WHERE id=$1 AND attempts<8 AND next_attempt_at<=NOW()
    AND (status='pending' OR (status='sending' AND locked_at<NOW()-INTERVAL '5 minutes')) RETURNING *`,[id])).rows[0];
  if (!row) return;
  try {
    await mail.send({to:[row.recipient],...require('./password-changed-email').render(row.language)});
    await db.query("UPDATE password_change_notifications SET status='sent',sent_at=NOW(),error_code=NULL WHERE id=$1",[id]);
  } catch (error) {
    await db.query("UPDATE password_change_notifications SET status='pending',error_code=$2,next_attempt_at=NOW()+INTERVAL '5 minutes' WHERE id=$1",[id,String(error.code || 'MAIL_SEND_FAILED').slice(0,80)]);
    console.error('[password changed notification] DELIVERY_PENDING');
  }
}
async function retry() {
  const rows = (await db.query("SELECT id FROM password_change_notifications WHERE status<>'sent' AND attempts<8 AND next_attempt_at<=NOW() ORDER BY created_at LIMIT 10")).rows;
  for (const row of rows) await deliver(row.id);
  return rows.length;
}
module.exports = { enqueue, deliver, retry };
