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
              e.benefit_instructions, u.is_premium, u.is_active
         FROM experiences e CROSS JOIN users u
        WHERE e.id = $1 AND u.id = $2 AND e.is_published = TRUE
          AND e.access = 'premium' AND e.benefit_action = 'qr'`,
      [experienceId, userId]
    );
    const record = rows[0];
    if (!record || !record.is_active || !record.is_premium) {
      await client.query('ROLLBACK');
      if (!record) return { error: 'Este beneficio no está disponible.', status: 404 };
      if (!record.is_active) return { error: 'Tu cuenta no está activa.', status: 403 };
      return { error: 'Necesitas una membresía ITC Club activa.', status: 403 };
    }

    await client.query(
      `UPDATE benefit_redemptions SET revoked_at = NOW()
        WHERE experience_id = $1 AND user_id = $2
          AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
      [experienceId, userId]
    );
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

module.exports = { VALIDITY_HOURS, hashToken, issue, find, redeem, state };
