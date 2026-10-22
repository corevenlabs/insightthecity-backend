const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
if(process.env.DB_DATABASE!=='itc_crm_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated DB only');
process.env.JWT_SECRET='isolated-web-deletion-test';process.env.OPENAI_API_KEY='test-never-call';
const db=require('../config/db'),service=require('../services/web-account-deletion.service'),deletion=require('../services/account-deletion.service'),mail=require('../services/password-reset-mail.service');
const messages=[];let sendsFail=false;
mail.isConfigured=()=>true;mail.send=async message=>{if(sendsFail)throw Error('mail down');messages.push(message);};
let server;
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db.end();});
test('web deletion separates email verification from explicit deletion, consumes proof and prevents replay',async()=>{
 for(const f of ['schema.sql','security-hardening.sql','account-deletion.sql','web-account-deletion.sql','legal-evidence.sql','private-avatars.sql'])await db.query(fs.readFileSync(`database/${f}`,'utf8'));
 const email=`web-delete-${Date.now()}@example.test`;
 const user=(await db.query('INSERT INTO users(email) VALUES($1) RETURNING id',[email])).rows[0];
 const worker=deletion.processJob;let processed=0;deletion.processJob=async()=>{processed++;};
 try{
  const unknown=await service.requestCode('nonexistent@example.test');assert.ok(unknown.challenge);assert.equal(messages.length,0);
  const issued=await service.requestCode(email,'es');assert.equal(messages.length,1);assert.ok(messages[0].html.includes('new-york.jpg'));assert.ok(messages[0].html.includes('itc-club-logo-v1.png'));
  const code=messages[0].text.match(/\b\d{8}\b/)[0];
  await service.requestCode(email);assert.equal(messages.length,1);
  let row=(await db.query('SELECT * FROM account_deletion_challenges WHERE user_id=$1',[user.id])).rows[0];assert.notEqual(row.code_hash,code);
  const wrong=code==='00000000'?'11111111':'00000000';assert.equal(await service.verifyCode(issued.challenge,wrong),null);
  const verified=await service.verifyCode(issued.challenge,code);assert.equal(verified.proof.length,64);
  assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[user.id])).rows[0].is_active,true);
  assert.equal((await db.query('SELECT id FROM account_deletions WHERE user_id=$1',[user.id])).rowCount,0);
  assert.equal(await service.verifyCode(issued.challenge,code),null);
  await assert.rejects(service.confirm(verified.proof,false));assert.equal(processed,0);
  const result=await service.confirm(verified.proof,true);assert.equal(result.requested,true);assert.equal(processed,1);
  assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[user.id])).rows[0].is_active,false);
  assert.equal(await service.confirm(verified.proof,true),null);assert.equal(processed,1);
 }finally{deletion.processJob=worker;await db.query('DELETE FROM account_deletions WHERE user_id=$1',[user.id]);await db.query('DELETE FROM users WHERE id=$1',[user.id]);}
});
test('expired codes, attempt limits, expiring proofs and failed delivery cannot authorize deletion',async()=>{
 const email=`web-limit-${Date.now()}@example.test`,user=(await db.query('INSERT INTO users(email) VALUES($1) RETURNING id',[email])).rows[0];
 try{
  let issued=await service.requestCode(email);let code=messages.at(-1).text.match(/\b\d{8}\b/)[0];
  await db.query("UPDATE account_deletion_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",[user.id]);assert.equal(await service.verifyCode(issued.challenge,code),null);
  await db.query("UPDATE account_deletion_challenges SET requested_at=NOW()-INTERVAL '61 seconds' WHERE user_id=$1",[user.id]);
  issued=await service.requestCode(email);code=messages.at(-1).text.match(/\b\d{8}\b/)[0];
  const wrong=code==='00000000'?'11111111':'00000000';for(let i=0;i<5;i++)assert.equal(await service.verifyCode(issued.challenge,wrong),null);assert.equal(await service.verifyCode(issued.challenge,code),null);
  await db.query("UPDATE account_deletion_challenges SET requested_at=NOW()-INTERVAL '61 seconds' WHERE user_id=$1",[user.id]);
  issued=await service.requestCode(email);code=messages.at(-1).text.match(/\b\d{8}\b/)[0];
  const verified=await service.verifyCode(issued.challenge,code);
  await db.query("UPDATE account_deletion_challenges SET proof_expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",[user.id]);assert.equal(await service.confirm(verified.proof,true),null);
  await db.query("UPDATE account_deletion_challenges SET requested_at=NOW()-INTERVAL '61 seconds' WHERE user_id=$1",[user.id]);
  sendsFail=true;await service.requestCode(email);sendsFail=false;
  assert.equal((await db.query('SELECT id FROM account_deletion_challenges WHERE user_id=$1',[user.id])).rowCount,0);
 }finally{sendsFail=false;await db.query('DELETE FROM users WHERE id=$1',[user.id]);}
});
test('public page, assets and API enforce no caching, explicit confirmation and protected worker',async()=>{
 server=require('../server').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const lang of ['es','en','pt']){
  const r=await fetch(base+`/delete-account?lang=${lang}`);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));const html=await r.text();assert.ok(html.includes('id="consent"'));assert.ok(html.includes('id="confirm-button" disabled'));assert.ok(html.includes('one-time-code'));
 }
 assert.equal((await fetch(base+'/account-deletion-assets/page.js')).status,200);
 assert.equal((await fetch(base+'/api/account-deletions/process',{method:'POST'})).status,401);
 assert.equal((await fetch(base+'/api/account-deletions/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proof:'x',accept:false})})).status,400);
 assert.equal((await fetch(base+'/api/account-deletions/confirm',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'accept=true'})).status,415);
});
test('complete web request sends matching code, receipt and final emails in the selected language',async()=>{
 const email=`web-complete-${Date.now()}@example.test`;
 const user=(await db.query('INSERT INTO users(email) VALUES($1) RETURNING id',[email])).rows[0];
 const prior=messages.length;
 const issue=await service.requestCode(email,'en'),code=messages.at(-1).text.match(/\b\d{8}\b/)[0];
 const verify=await service.verifyCode(issue.challenge,code);
 assert.equal((await service.confirm(verify.proof,true)).requested,true);
 const sequence=messages.slice(prior);assert.equal(sequence.length,3);
 assert.match(sequence[0].subject,/Verify/);assert.match(sequence[1].subject,/request received/);assert.match(sequence[2].subject,/completed/);
 for(const message of sequence){assert.ok(message.html.includes('itc-club-logo-v1.png'));assert.ok(message.html.includes('new-york.jpg'));assert.ok(message.html.includes('#FDDD56'));}
 assert.equal((await db.query('SELECT id FROM users WHERE id=$1',[user.id])).rowCount,0);
 assert.equal((await db.query('SELECT id FROM account_deletion_challenges WHERE user_id=$1',[user.id])).rowCount,0);
 const job=(await db.query("SELECT id FROM account_deletions WHERE status='completed' ORDER BY completed_at DESC LIMIT 1")).rows[0];
 if(job)await db.query('DELETE FROM account_deletions WHERE id=$1',[job.id]);
});

test('Apple-only member can request deletion by email without creating a password',async()=>{
 await db.query(fs.readFileSync('database/apple-auth.sql','utf8'));
 const email=`apple-deletion-${Date.now()}@example.test`;
 const user=(await db.query("INSERT INTO users(email,password_hash,is_premium,stripe_subscription_id,subscription_status) VALUES($1,NULL,TRUE,'sub_apple_local_only','active') RETURNING id",[email])).rows[0];
 await db.query('INSERT INTO apple_auth_identities(subject,user_id) VALUES($1,$2)',['apple-delete-local-'+user.id,user.id]);
 const worker=deletion.processJob;deletion.processJob=async()=>{};
 try {
  const issued=await service.requestCode(email);
  const code=messages.at(-1).text.match(/\b\d{8}\b/)[0];
  assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[user.id])).rows[0].is_active,true);
  const verified=await service.verifyCode(issued.challenge,code);
  assert.ok(verified?.proof);
  assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[user.id])).rows[0].is_active,true);
  assert.equal((await service.confirm(verified.proof,true)).requested,true);
  const row=(await db.query('SELECT is_active,password_hash FROM users WHERE id=$1',[user.id])).rows[0];
  assert.equal(row.is_active,false);assert.equal(row.password_hash,null);
  const job=(await db.query('SELECT * FROM account_deletions WHERE user_id=$1',[user.id])).rows[0];
  assert.equal(job.subscription_id,'sub_apple_local_only');assert.equal(job.stripe_done,false);assert.equal(job.status,'pending');
  assert.equal(await service.confirm(verified.proof,true),null);
 }finally{
  deletion.processJob=worker;
  await db.query('DELETE FROM account_deletions WHERE user_id=$1',[user.id]);
  await db.query('DELETE FROM users WHERE id=$1',[user.id]);
 }
});
