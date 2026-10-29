// Restore only the previously authorized early activation to its original start date.
const assert = require('node:assert/strict');
const { audit, TARGET, EXPECTED_START, EXPECTED_END } = require('./activate-nuyores-qr.cjs');
const EARLY_START = '2026-10-29T04:20:51.913Z';
const iso = value => value ? new Date(value).toISOString() : null;
async function restore(client, { id=TARGET, originalStart=EXPECTED_START, expectedEnd=EXPECTED_END, earlyStart=EARLY_START }={}) {
 const before=(await client.query('SELECT *,coupon_starts_at::text AS stored_start,NOW() AS database_now FROM experiences WHERE id=$1 FOR UPDATE',[id])).rows[0];
 assert.ok(before,'Target not found');
 assert.equal(before.is_published,true);assert.equal(before.access,'premium');assert.equal(before.benefit_action,'qr');
 assert.equal(iso(before.coupon_ends_at),expectedEnd,'Expiration changed; do not overwrite');
 assert.ok(new Date(originalStart)>before.database_now,'Original start is no longer in the future');
 if(iso(before.coupon_starts_at)===originalStart)return {changed:false,id,title:before.title,reason:'already-scheduled',startsAt:originalStart,endsAt:expectedEnd};
 assert.equal(iso(before.coupon_starts_at),earlyStart,'Schedule changed since early activation; do not overwrite');
 const after=(await client.query(`UPDATE experiences SET coupon_starts_at=$2::timestamptz,updated_at=NOW()
  WHERE id=$1 AND coupon_starts_at=$3::timestamptz AND coupon_ends_at=$4::timestamptz RETURNING *`,[id,originalStart,before.stored_start,expectedEnd])).rows[0];
 assert.ok(after,'Concurrent schedule change');
 for(const key of Object.keys(after).filter(k=>!['coupon_starts_at','updated_at'].includes(k)))assert.deepEqual(after[key],before[key],'Unexpected change to '+key);
 return {changed:true,id,title:after.title,previousStart:earlyStart,previousStartStored:before.stored_start,startsAt:iso(after.coupon_starts_at),endsAt:iso(after.coupon_ends_at)};
}
async function main(){
 const db=require('../config/db'),client=await db.connect(),apply=process.env.RESTORE_NUYORES_SCHEDULE==='true';
 try{await client.query(apply?'BEGIN':'BEGIN READ ONLY');const before=await audit(client),correction=apply?await restore(client):null,after=await audit(client);
 if(apply)assert.ok(['scheduled','manually-paused'].includes(after.find(x=>x.id===TARGET)?.status));
 await client.query(apply?'COMMIT':'ROLLBACK');console.log(JSON.stringify({apply,correction,before,after},null,2));
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await db.end();}
}
module.exports={restore,EARLY_START};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
