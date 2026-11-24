const db = require('../config/db');
const { SAVED_SYNC } = require('./push-automations.service');

const DAYS = 90;

// Deletes who received and opened push notices after 90 days, in bounded batches.
async function sweep() {
  // Totals and deletions share one snapshot, so the panel keeps its figures without personal rows.
  const campaigns = await db.query(`WITH c AS (
      SELECT id FROM push_campaigns WHERE status IN ('sent','canceled') AND final_stats IS NULL
        AND COALESCE(finished_at, updated_at) < NOW()-make_interval(days=>${DAYS})
      ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED
    ), totals AS (
      SELECT c.id,
        (SELECT jsonb_build_object(
          'sent', COUNT(*) FILTER (WHERE status='sent'), 'pending', 0,
          'skipped', COUNT(*) FILTER (WHERE status IN ('skipped','pending')),
          'failed', COUNT(*) FILTER (WHERE status='failed')) FROM push_messages WHERE campaign_id=c.id) AS stats,
        (SELECT COUNT(*)::int FROM push_campaign_opens WHERE campaign_id=c.id) AS opens
      FROM c
    ), messages AS (DELETE FROM push_messages m USING c WHERE m.campaign_id=c.id),
    opens AS (DELETE FROM push_campaign_opens o USING c WHERE o.campaign_id=c.id)
    UPDATE push_campaigns p SET final_stats=totals.stats, final_opens=totals.opens FROM totals WHERE p.id=totals.id`);
  // membership_active / membership_ended stay while the account exists: their key is what stops a
  // later renewal webhook from announcing the same membership again.
  const notices = await db.query(`DELETE FROM push_messages WHERE id IN (
    SELECT id FROM push_messages WHERE campaign_id IS NULL AND status<>'pending'
      AND kind NOT IN ('membership_active','membership_ended')
      AND created_at < NOW()-make_interval(days=>${DAYS}) ORDER BY created_at LIMIT 1000)`);
  // Copies of saved experiences that can no longer be used for a reminder. The app sends them again if that changes.
  const saved = await db.query(`DELETE FROM saved_experiences s USING users u WHERE u.id=s.user_id AND NOT (${SAVED_SYNC})`);
  return { campaigns: campaigns.rowCount, notices: notices.rowCount, saved: saved.rowCount };
}

module.exports = { DAYS, sweep };
