const db = require('../config/db');
const { SAVED_SYNC } = require('./push-automations.service');
const { MARKED_KINDS } = require('./push-notifications.service');

const DAYS = 90;
// A device that has not opened the app for this long is forgotten; opening it registers it again.
const TOKEN_DAYS = 180;

// Deletes who received and opened push notices 90 days after they were sent, in bounded batches.
// Nothing can postpone it: not a campaign that never closed nor a notice that was never delivered.
async function sweep() {
  // Totals and deletions share one snapshot, so the panel keeps its figures without personal rows.
  const campaigns = await db.query(`WITH c AS (
      SELECT id FROM push_campaigns WHERE status IN ('sending','sent','canceled') AND final_stats IS NULL
        AND COALESCE(started_at, finished_at, updated_at) < NOW()-make_interval(days=>${DAYS})
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
    UPDATE push_campaigns p SET final_stats=totals.stats, final_opens=totals.opens,
      status=CASE WHEN p.status='sending' THEN 'sent' ELSE p.status END, finished_at=COALESCE(p.finished_at, NOW()) FROM totals WHERE p.id=totals.id`);
  // Membership notices leave only an irreversible code behind, in the same statement that deletes them.
  const notices = await db.query(`WITH old AS (
      DELETE FROM push_messages WHERE id IN (
        SELECT id FROM push_messages WHERE campaign_id IS NULL
          AND created_at < NOW()-make_interval(days=>${DAYS}) ORDER BY created_at LIMIT 1000)
      RETURNING user_id, kind, dedupe_key
    ), markers AS (
      INSERT INTO push_notice_markers(user_id, key_hash)
      SELECT user_id, encode(sha256(convert_to(dedupe_key,'UTF8')),'hex') FROM old WHERE kind = ANY($1::varchar[])
      ON CONFLICT DO NOTHING
    ) SELECT COUNT(*)::int AS n FROM old`, [MARKED_KINDS]);
  const tokens = await db.query(`DELETE FROM push_tokens WHERE last_seen_at < NOW()-make_interval(days=>${TOKEN_DAYS})`);
  // Copies of saved experiences that can no longer be used for a reminder. The app sends them again if that changes.
  const saved = await db.query(`DELETE FROM saved_experiences s USING users u WHERE u.id=s.user_id AND NOT (${SAVED_SYNC})`);
  return { campaigns: campaigns.rowCount, notices: notices.rows[0].n, tokens: tokens.rowCount, saved: saved.rowCount };
}

module.exports = { DAYS, TOKEN_DAYS, sweep };
