// One authorized correction: start Nuyores now; preserve expiration, limits and redemptions.
const assert = require('node:assert/strict');
const TARGET = 'draft-cf27f1a0-da78-431e-8a1d-9299207a1ee1';
const EXPECTED_START = '2026-11-16T03:33:00.000Z';
const EXPECTED_END = '2026-12-16T03:33:00.000Z';
const fields = `id,title,is_published,access,benefit_action,coupon_active,coupon_starts_at,
  coupon_ends_at,coupon_inventory_mode,coupon_total,coupon_per_user,coupon_low_stock,
  member_benefit,member_benefit_details,benefit_instructions`;
const iso = value => value ? new Date(value).toISOString() : null;
async function activate(client, { id = TARGET, expectedStart = EXPECTED_START, expectedEnd = EXPECTED_END } = {}) {
  const before = (await client.query(`SELECT ${fields},NOW() AS database_now FROM experiences WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  assert.ok(before, 'Target not found');
  assert.equal(before.is_published, true, 'Target must remain published');
  assert.equal(before.access, 'premium');
  assert.equal(before.benefit_action, 'qr', 'Do not replace an external offer');
  assert.equal(before.coupon_active, true, 'Do not override a manual pause');
  assert.equal(iso(before.coupon_ends_at), expectedEnd, 'Expiration changed; review required');
  assert.ok(new Date(expectedEnd) > before.database_now, 'Do not reactivate an expired campaign');
  if (!before.coupon_starts_at || new Date(before.coupon_starts_at) <= before.database_now) {
    return { changed: false, id, title: before.title, reason: 'already-started', startsAt: iso(before.coupon_starts_at), endsAt: iso(before.coupon_ends_at) };
  }
  assert.equal(iso(before.coupon_starts_at), expectedStart, 'Schedule changed; review required');
  const after = (await client.query(`UPDATE experiences SET coupon_starts_at=NOW(),updated_at=NOW()
    WHERE id=$1 AND coupon_starts_at=$2::timestamptz
      AND coupon_ends_at=$3::timestamptz RETURNING ${fields}`,
    [id, expectedStart, expectedEnd])).rows[0];
  assert.ok(after, 'Schedule changed while correcting it');
  for (const key of Object.keys(after).filter(key => key !== 'coupon_starts_at')) {
    assert.deepEqual(after[key], before[key], 'Unexpected change to '+key);
  }
  assert.ok(new Date(after.coupon_starts_at) <= before.database_now);
  return { changed: true, id, title: after.title, previousStart: iso(before.coupon_starts_at), startsAt: iso(after.coupon_starts_at), endsAt: iso(after.coupon_ends_at) };
}
async function audit(client) {
  const { rows } = await client.query(`SELECT e.id,e.title,e.coupon_active,e.coupon_starts_at,e.coupon_ends_at,
    e.coupon_inventory_mode,e.coupon_total,e.coupon_per_user,NOW() AS database_now,
    COUNT(r.id) FILTER (WHERE r.redeemed_at IS NOT NULL)::int AS redeemed,
    COUNT(r.id) FILTER (WHERE r.redeemed_at IS NULL AND r.revoked_at IS NULL AND r.expires_at>NOW())::int AS reserved
    FROM experiences e LEFT JOIN benefit_redemptions r ON r.experience_id=e.id
    WHERE e.is_published=TRUE AND e.access='premium' AND e.benefit_action='qr'
    GROUP BY e.id ORDER BY e.title`);
  return rows.map(r => {
    const available = r.coupon_inventory_mode === 'limited' ? Math.max(0,Number(r.coupon_total||0)-r.redeemed-r.reserved) : null;
    const reason = !r.coupon_active ? 'manually-paused'
      : r.coupon_starts_at && r.coupon_starts_at>r.database_now ? 'scheduled'
      : r.coupon_ends_at && r.coupon_ends_at<=r.database_now ? 'expired'
      : available===0 ? 'sold-out' : 'available';
    return {id:r.id,title:r.title,status:reason,startsAt:iso(r.coupon_starts_at),endsAt:iso(r.coupon_ends_at),inventory:r.coupon_inventory_mode,available,reserved:r.reserved,redeemed:r.redeemed,perUser:r.coupon_per_user};
  });
}
async function main() {
  const db = require('../config/db');
  const client = await db.connect();
  const apply = process.env.ACTIVATE_NUYORES_NOW === 'true';
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const before = await audit(client);
    const correction = apply ? await activate(client) : null;
    const after = await audit(client);
    if (apply) assert.equal(after.find(r=>r.id===TARGET)?.status,'available');
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({apply,correction,before,after},null,2));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await db.end(); }
}
module.exports = { activate, audit, TARGET, EXPECTED_START, EXPECTED_END };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode=1; });
