// One-record operation authorized by the owner. Place IDs come from their public My Maps.
const assert = require('node:assert/strict');
const locations = require('./birria-landia-branches.json');
const TARGET = 'draft-70a9eddd-ab4b-459b-88fe-3719bf0cab28';
const MID = '1cWJnUvKE7_iMLxMEBavjy0LPdwi6oIc';
function checkExisting(value) {
  assert.ok(Array.isArray(value), 'Expected locations array');
  if (value.length) assert.deepEqual(value, locations, 'Existing branches changed; refusing to overwrite');
}
function checkUnchanged(before, after, allowed) {
  for (const key of Object.keys(before)) if (!allowed.includes(key)) assert.deepEqual(after[key], before[key], 'Unexpected change to '+key);
}
async function register(client, apply) {
  assert.equal(locations.length, 7);
  assert.equal(new Set(locations.map(x=>x.placeId)).size, 7);
  for (const x of locations) assert.ok(x.name && x.address && /^ChIJ[A-Za-z0-9_-]+$/.test(x.placeId) && x.benefitApplies === true);
  const before = (await client.query('SELECT * FROM experiences WHERE id=$1 FOR UPDATE', [TARGET])).rows[0];
  assert.ok(before, 'Experience not found');
  assert.equal(before.title, 'Birria-Landia');
  assert.equal(before.is_published, true);
  assert.equal(new URL(before.maps_url).searchParams.get('mid'), MID);
  checkExisting(before.locations);
  const drafts = (await client.query('SELECT * FROM experience_drafts WHERE experience_id=$1 FOR UPDATE', [TARGET])).rows;
  for (const draft of drafts) checkExisting(draft.payload.locations || []);
  if (apply) {
    const after = (await client.query('UPDATE experiences SET locations=$2::jsonb,updated_at=NOW() WHERE id=$1 RETURNING *', [TARGET,JSON.stringify(locations)])).rows[0];
    assert.deepEqual(after.locations, locations);
    checkUnchanged(before, after, ['locations','updated_at']);
    for (const draft of drafts) {
      const afterDraft = (await client.query("UPDATE experience_drafts SET payload=jsonb_set(payload,'{locations}',$2::jsonb,true),updated_at=NOW() WHERE id=$1 RETURNING *",[draft.id,JSON.stringify(locations)])).rows[0];
      checkUnchanged(draft,afterDraft,['payload','updated_at']);
      assert.deepEqual(afterDraft.payload,{...draft.payload,locations});
    }
  }
  return {apply,id:TARGET,title:before.title,previousLocations:before.locations,locations,linkedDraftsUpdated:apply?drafts.length:0,mapsUrl:before.maps_url};
}
async function main() {
  const db = require('../config/db'), client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    const result=await register(client,process.env.APPLY_BIRRIA_BRANCHES==='true');
    await client.query(result.apply?'COMMIT':'ROLLBACK');
    console.log(JSON.stringify(result,null,2));
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); await db.end(); }
}
module.exports={register,locations,TARGET};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
