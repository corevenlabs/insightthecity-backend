const fs = require('node:fs');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const [spec] = require('../config/partner-external-agreements.json');
const apply = process.argv.includes('--apply');
async function run() {
  const c = await db.connect();
  try {
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const row = (await c.query(`SELECT * FROM partner_clients WHERE id=$1${apply ? ' FOR UPDATE' : ''}`, [spec.clientId])).rows[0];
    assert.ok(row && !row.deleted_at && !row.blocked_at, 'Client unavailable');
    assert.equal(row.business_name, spec.businessName);
    assert.equal(row.category, 'strategic'); assert.equal(row.offer, 'strategic'); assert.equal(row.amount_cents, 0);
    assert.equal(row.payment_method, 'waived'); assert.equal(row.payment_status, 'waived');
    assert.equal(row.form_status, 'invited');
    assert.ok(!row.activated_at && !row.payment_verified_at && !row.stripe_session_id && !row.stripe_payment_intent, 'Checkout already started or verified; stop');
    assert.ok([spec.previousInvitationVersion, spec.invitationVersion].includes(row.link_version), 'Unexpected invitation version');
    const accepted = (await c.query("SELECT COUNT(*)::int AS count FROM partner_acceptances WHERE client_id=$1 AND stage='commercial'", [row.id])).rows[0];
    assert.equal(accepted.count, 0, 'Commercial acceptance already exists; stop');
    const othersBefore = (await c.query('SELECT COUNT(*)::int AS count FROM partner_clients WHERE id=$1 AND deleted_at IS NULL', [row.id])).rows[0];
    assert.equal(othersBefore.count, 1);
    const alreadyPrepared = row.link_version === spec.invitationVersion;
    let current = row;
    if (apply && !alreadyPrepared) {
      current = (await c.query("UPDATE partner_clients SET link_version=$2,link_expires_at=NOW()+INTERVAL '90 days',updated_at=NOW() WHERE id=$1 AND link_version=$3 RETURNING *", [row.id, spec.invitationVersion, spec.previousInvitationVersion])).rows[0];
      assert.ok(current);
      for (const key of Object.keys(row)) {
        if (!['link_version', 'link_expires_at', 'updated_at'].includes(key)) assert.deepEqual(current[key], row[key], `Unexpected change: ${key}`);
      }
      await c.query("INSERT INTO partner_activity(client_id,actor_id,kind,note) VALUES($1,NULL,'external-agreement-invitation',$2)", [row.id, JSON.stringify({reference: spec.reference, basis: spec.basis, invitationVersion: spec.invitationVersion})]);
    }
    if (apply) {
      assert.ok(process.env.JWT_SECRET, 'Signing secret unavailable');
      const token = jwt.sign({type:'partner',id:current.id,v:current.link_version,exp:Math.floor(new Date(current.link_expires_at).getTime()/1000)}, process.env.JWT_SECRET);
      fs.writeFileSync('/tmp/broadway-private-invitation.json', JSON.stringify({business:current.business_name,link:`https://itc-panel-1031252664334.us-east1.run.app/partner#${token}`},null,2), {mode:0o600});
    }
    await c.query('COMMIT');
    console.log(JSON.stringify({apply, alreadyPrepared, business:row.business_name, noCheckoutStarted:true, onlineAcceptances:accepted.count, changes:apply && !alreadyPrepared ? ['link_version','link_expires_at','updated_at','activity'] : [], emailsSent:0}));
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); await db.end(); }
}
run().catch(e => {console.error(e.message);process.exitCode=1;});
