const db = require('../config/db');
// Bounded batches preserve retry/deduplication records and legal/payment snapshots.
async function sweep() {
  await db.query("DELETE FROM security_rate_limits WHERE reset_at<NOW()-INTERVAL '1 day'");
  await db.query("DELETE FROM account_deletion_challenges WHERE expires_at<NOW()-INTERVAL '1 day'");
  await db.query(`DELETE FROM chat_messages WHERE id IN (
    SELECT id FROM chat_messages WHERE created_at < NOW()-INTERVAL '90 days'
    ORDER BY created_at LIMIT 1000)`);
  await db.query(`UPDATE partner_mail SET recipient='',message='{}'::jsonb,error_code=NULL WHERE id IN (
    SELECT id FROM partner_mail WHERE status IN ('sent','canceled')
      AND COALESCE(sent_at,created_at)<NOW()-INTERVAL '90 days'
      AND (recipient<>'' OR message<>'{}'::jsonb)
    ORDER BY created_at LIMIT 1000)`);
  await db.query("DELETE FROM password_reset_codes WHERE expires_at<NOW()-INTERVAL '1 day'");
}
module.exports={sweep};
