// Run only against an isolated local database; never production.
const {test,after}=require('node:test'), assert=require('node:assert/strict');
if(process.env.DB_DATABASE!=='itc_qr_consent_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated local database required');
process.env.JWT_SECRET='isolated-qr-consent-test';
const db=require('../config/db'),benefits=require('../services/benefits.service'),marketing=require('../services/marketing-consent.service'),users=require('../services/users.service'),legal=require('../services/legal.service');
const ids=[];const experienceId='test-qr-last-slot';
const originalLegal=legal.recordAcceptance;
legal.recordAcceptance=async()=>{}; // Test isolation: no published documents or remote translation service.
after(async()=>{legal.recordAcceptance=originalLegal;await db.query('DELETE FROM experiences WHERE id=$1',[experienceId]);if(ids.length)await db.query('DELETE FROM users WHERE id=ANY($1::int[])',[ids]);await db.end();});
test('Registration records only explicit marketing consent, in the selected language, and remains optional',async()=>{
 for(const [i,language,acceptMarketing] of [[1,'es',undefined],[2,'en',false],[3,'pt',true]]){
  const result=await users.register({name:'Local consent test',email:`local-consent-${i}@example.test`,password:'local-test-password',language,acceptMarketing});ids.push(result.user.id);
  const {rows:[row]}=await db.query('SELECT * FROM users WHERE id=$1',[result.user.id]);
  assert.equal(row.marketing_opt_in,acceptMarketing===true);
  if(acceptMarketing===true){assert.ok(row.marketing_consent_at);assert.equal(row.marketing_consent_language,language);assert.equal(row.marketing_consent_text,marketing.COPY.pt);assert.equal(row.marketing_consent_version,marketing.VERSION);assert.equal(row.marketing_consent_source,'email-register');}
  else {assert.equal(row.marketing_consent_at,null);assert.equal(row.marketing_consent_text,null);}
 }
 await assert.rejects(users.register({email:'invalid-consent@example.test',password:'test-password',acceptMarketing:'true'}),{status:400});
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM users WHERE email=$1',['invalid-consent@example.test'])).rows[0].n,0);
});
test('The final reserved QR remains available only to its owner after a localized reload; inventory and redemption remain atomic',async()=>{
 const [owner,other]=ids;
 await db.query('UPDATE users SET is_premium=TRUE WHERE id=ANY($1::int[])',[[owner,other]]);
 await db.query(`INSERT INTO experiences(id,title,category,access,is_published,benefit_action,coupon_inventory_mode,coupon_total,coupon_per_user,coupon_active) VALUES($1,'Local QR test','FOOD','premium',TRUE,'qr','limited',1,1,TRUE)`,[experienceId]);
 const first=await benefits.issue(experienceId,owner);assert.ok(first.token);
 assert.equal((await benefits.reservation(experienceId,owner)).reserved,true);
 assert.equal((await benefits.reservation(experienceId,other)).reserved,false);
 assert.equal((await benefits.issue(experienceId,other)).code,'SOLD_OUT');
 const replacement=await benefits.issue(experienceId,owner);assert.ok(replacement.token);assert.equal(benefits.state(await benefits.find(first.token)),'expired');
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM benefit_redemptions WHERE experience_id=$1 AND revoked_at IS NULL AND redeemed_at IS NULL AND expires_at>NOW()',[experienceId])).rows[0].n,1);
 await db.query('UPDATE experiences SET coupon_active=FALSE WHERE id=$1',[experienceId]);
 assert.equal((await benefits.reservation(experienceId,owner)).reserved,false);
 assert.equal((await benefits.issue(experienceId,owner)).code,'PAUSED');
 assert.equal(await benefits.redeem(replacement.token),null,'manual pause blocks previously issued QR');
 await db.query(`UPDATE experiences SET coupon_active=TRUE,coupon_starts_at=NOW()+INTERVAL '1 day' WHERE id=$1`,[experienceId]);
 assert.equal((await benefits.issue(experienceId,owner)).code,'PAUSED');
 assert.equal(await benefits.redeem(replacement.token),null,'future start blocks redemption');
 assert.equal(benefits.state(await benefits.find(replacement.token)),'paused');
 await db.query(`UPDATE experiences SET coupon_starts_at=NULL,coupon_ends_at=NOW()-INTERVAL '1 second' WHERE id=$1`,[experienceId]);
 assert.equal(await benefits.redeem(replacement.token),null,'end date blocks redemption');
 await db.query('UPDATE experiences SET coupon_ends_at=NULL WHERE id=$1',[experienceId]);
 const results=await Promise.all([benefits.redeem(replacement.token),benefits.redeem(replacement.token)]);
 assert.equal(results.filter(Boolean).length,1);
 assert.equal((await benefits.reservation(experienceId,owner)).reserved,false);
 assert.equal((await benefits.issue(experienceId,owner)).code,'USER_LIMIT');
});
