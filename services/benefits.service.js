const crypto = require('crypto');
const db = require('../config/db');

const VALIDITY_HOURS = 24;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function issue(experienceId, userId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT e.id, e.title, e.location, e.member_benefit, e.member_benefit_details,
              e.benefit_instructions, e.coupon_inventory_mode, e.coupon_total,
              e.coupon_per_user, e.coupon_active, e.coupon_starts_at, e.coupon_ends_at,
              u.is_premium, u.is_active
         FROM experiences e JOIN users u ON u.id = $2
        WHERE e.id = $1 AND e.is_published = TRUE
          AND e.access = 'premium' AND e.benefit_action = 'qr'
        FOR UPDATE OF e`,
      [experienceId, userId]
    );
    const record = rows[0];
    if (!record || !record.is_active || !record.is_premium) {
      await client.query('ROLLBACK');
      if (!record) return { error: 'Este beneficio no está disponible.', status: 404 };
      if (!record.is_active) return { error: 'Tu cuenta no está activa.', status: 403 };
      return { error: 'Necesitas una membresía ITC Club activa.', status: 403 };
    }

    const now = Date.now();
    if (!record.coupon_active || (record.coupon_starts_at && new Date(record.coupon_starts_at).getTime() > now) || (record.coupon_ends_at && new Date(record.coupon_ends_at).getTime() <= now)) {
      await client.query('ROLLBACK');
      return { error: 'Este beneficio no está disponible en este momento.', status: 409, code: 'PAUSED' };
    }

    await client.query(
      `UPDATE benefit_redemptions SET revoked_at = NOW()
        WHERE experience_id = $1 AND user_id = $2
          AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
      [experienceId, userId]
    );
    const userUsage = await client.query(
      `SELECT COUNT(*)::int AS redeemed FROM benefit_redemptions
        WHERE experience_id = $1 AND user_id = $2 AND redeemed_at IS NOT NULL`,
      [experienceId, userId]
    );
    if (userUsage.rows[0].redeemed >= Number(record.coupon_per_user || 1)) {
      await client.query('ROLLBACK');
      return { error: 'Ya utilizaste el máximo de cupones permitido para este beneficio.', status: 409, code: 'USER_LIMIT' };
    }
    if (record.coupon_inventory_mode === 'limited') {
      const inventory = await client.query(
        `SELECT
          COUNT(*) FILTER (WHERE redeemed_at IS NOT NULL)::int AS redeemed,
          COUNT(*) FILTER (WHERE redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW())::int AS reserved
         FROM benefit_redemptions WHERE experience_id = $1`, [experienceId]
      );
      const used = inventory.rows[0].redeemed + inventory.rows[0].reserved;
      if (used >= Number(record.coupon_total || 0)) {
        await client.query('ROLLBACK');
        return { error: 'Este beneficio está agotado.', status: 409, code: 'SOLD_OUT' };
      }
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const inserted = await client.query(
      `INSERT INTO benefit_redemptions (experience_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')
       RETURNING id, created_at, expires_at`,
      [experienceId, userId, hashToken(token)]
    );
    await client.query('COMMIT');
    return { token, ...inserted.rows[0], ...record };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function adminDashboard({ region, state: stateFilter, q, from, to } = {}) {
  const values = [];
  const where = [`e.benefit_action = 'qr'`];
  if (region) { values.push(region); where.push(`e.region = $${values.length}`); }
  if (q) { values.push(`%${q}%`); where.push(`(e.title ILIKE $${values.length} OR e.member_benefit ILIKE $${values.length})`); }
  const redemptionJoin = [];
  if (from) { values.push(from); redemptionJoin.push(`r.created_at >= $${values.length}::timestamptz`); }
  if (to) { values.push(to); redemptionJoin.push(`r.created_at < ($${values.length}::date + INTERVAL '1 day')`); }
  const whereSql = where.join(' AND ');
  const { rows } = await db.query(
    `SELECT e.id, e.title, e.region, e.image_url, e.member_benefit,
      e.coupon_inventory_mode, e.coupon_total, e.coupon_low_stock, e.coupon_active,
      e.coupon_starts_at, e.coupon_ends_at,
      COUNT(r.id) FILTER (WHERE r.redeemed_at IS NOT NULL)::int AS redeemed,
      COUNT(r.id) FILTER (WHERE r.redeemed_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > NOW())::int AS reserved,
      COUNT(r.id) FILTER (WHERE r.redeemed_at IS NULL AND r.expires_at <= NOW() AND r.revoked_at IS NULL)::int AS expired
     FROM experiences e LEFT JOIN benefit_redemptions r ON r.experience_id = e.id ${redemptionJoin.length ? `AND ${redemptionJoin.join(' AND ')}` : ''}
     WHERE ${whereSql}
     GROUP BY e.id ORDER BY e.title`, values
  );
  const campaigns = rows.map((row) => {
    const total = row.coupon_inventory_mode === 'limited' ? Number(row.coupon_total || 0) : null;
    const available = total === null ? null : Math.max(0, total - row.redeemed - row.reserved);
    const inWindow = (!row.coupon_starts_at || new Date(row.coupon_starts_at) <= new Date()) && (!row.coupon_ends_at || new Date(row.coupon_ends_at) > new Date());
    const status = !row.coupon_active || !inWindow ? 'paused' : available === 0 ? 'sold_out' : available !== null && available <= row.coupon_low_stock ? 'low_stock' : 'available';
    return { id: row.id, title: row.title, region: row.region, image: row.image_url, benefit: row.member_benefit, inventoryMode: row.coupon_inventory_mode, total, available, reserved: row.reserved, redeemed: row.redeemed, expired: row.expired, lowStock: row.coupon_low_stock, status };
  }).filter((item) => !stateFilter || item.status === stateFilter);

  const ids = campaigns.map((item) => item.id);
  let activity = [];
  if (ids.length) {
    const activityValues = [ids];
    const activityWhere = [`r.experience_id = ANY($1::varchar[])`];
    if (from) { activityValues.push(from); activityWhere.push(`r.created_at >= $${activityValues.length}::timestamptz`); }
    if (to) { activityValues.push(to); activityWhere.push(`r.created_at < ($${activityValues.length}::date + INTERVAL '1 day')`); }
    const activityResult = await db.query(
      `SELECT r.id, r.experience_id, e.title, e.region, r.created_at, r.expires_at, r.redeemed_at, r.revoked_at,
        CASE WHEN r.redeemed_at IS NOT NULL THEN 'redeemed'
             WHEN r.revoked_at IS NOT NULL THEN 'revoked'
             WHEN r.expires_at <= NOW() THEN 'expired' ELSE 'reserved' END AS status
       FROM benefit_redemptions r JOIN experiences e ON e.id = r.experience_id
       WHERE ${activityWhere.join(' AND ')} ORDER BY r.created_at DESC LIMIT 50`, activityValues
    );
    activity = activityResult.rows.map((row) => ({ id: row.id, reference: `ITC-${row.id}`, experienceId: row.experience_id, title: row.title, region: row.region, status: row.status, createdAt: row.created_at, expiresAt: row.expires_at, redeemedAt: row.redeemed_at }));
  }
  const summary = campaigns.reduce((acc, item) => {
    if (item.total !== null) { acc.total += item.total; acc.available += item.available || 0; }
    acc.reserved += item.reserved; acc.redeemed += item.redeemed; acc.expired += item.expired;
    if (item.status === 'low_stock') acc.lowStock += 1;
    if (item.status === 'sold_out') acc.soldOut += 1;
    return acc;
  }, { total: 0, available: 0, reserved: 0, redeemed: 0, expired: 0, lowStock: 0, soldOut: 0 });
  summary.redemptionRate = summary.total ? Math.round((summary.redeemed / summary.total) * 100) : 0;
  return { summary, campaigns, activity, updatedAt: new Date().toISOString() };
}

async function find(token) {
  const { rows } = await db.query(
    `SELECT r.id, r.created_at, r.expires_at, r.redeemed_at, r.revoked_at,
            e.title, e.location, e.member_benefit, e.member_benefit_details, e.benefit_instructions
       FROM benefit_redemptions r
       JOIN experiences e ON e.id = r.experience_id
      WHERE r.token_hash = $1`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

async function redeem(token) {
  const { rows } = await db.query(
    `UPDATE benefit_redemptions SET redeemed_at = NOW()
      WHERE token_hash = $1 AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
      RETURNING redeemed_at`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

function state(record) {
  if (!record) return 'invalid';
  if (record.redeemed_at) return 'redeemed';
  if (record.revoked_at || new Date(record.expires_at).getTime() <= Date.now()) return 'expired';
  return 'valid';
}

module.exports = { VALIDITY_HOURS, hashToken, issue, find, redeem, state, adminDashboard };
