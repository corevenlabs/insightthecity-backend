const {test,after}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),jwt=require('jsonwebtoken'),fs=require('node:fs');
if(process.env.DB_DATABASE!=='itc_crm_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated local DB only');
process.env.JWT_SECRET='apple-delete-local-only';
const db=require('../config/db'),users=require('../services/users.service'),deletion=require('../services/account-deletion.service');
const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'delete-test',alg:'RS256'};
const oldFetch=global.fetch;global.fetch=async url=>{assert.equal(url,'https://appleid.apple.com/auth/keys');return {ok:true,json:async()=>({keys:[jwk]})};};
const apple=require('../services/apple-auth.service');
const oldProcess=deletion.processJob;let processed=0;deletion.processJob=async()=>{processed++;};
after(async()=>{global.fetch=oldFetch;deletion.processJob=oldProcess;await db.end();});
const signed=(sub,nonce)=>jwt.sign({sub,nonce},privateKey,{algorithm:'RS256',keyid:'delete-test',issuer:'https://appleid.apple.com',audience:'com.insightthecity.app',expiresIn:300});
async function create(){const u=(await db.query("INSERT INTO users(email,password_hash,is_premium,subscription_status,stripe_subscription_id) VALUES($1,NULL,TRUE,'active',$2) RETURNING *",[`apple-delete-${crypto.randomUUID()}@example.test`,'sub_fake_'+crypto.randomUUID()])).rows[0];u.subject='local-apple-'+u.id;await db.query('INSERT INTO apple_auth_identities(subject,user_id) VALUES($1,$2)',[u.subject,u.id]);return u;}
async function cleanup(u){await db.query('DELETE FROM account_deletions WHERE user_id=$1',[u.id]);await db.query('DELETE FROM users WHERE id=$1',[u.id]);}
test('recent Apple session deletes without email; regular session iat cannot replace Apple authentication',async()=>{
 await db.query(fs.readFileSync('database/apple-auth.sql','utf8'));
 await db.query("DELETE FROM users WHERE email LIKE 'apple-delete-%@example.test' AND stripe_subscription_id='sub_fake_local'");
 const u=await create();
 try{
  const ordinary=jwt.verify(users.signToken(u),process.env.JWT_SECRET);
  assert.equal(ordinary.auth_time,undefined);
  await assert.rejects(apple.requestDeletion(u.id,ordinary,{confirm:true}),{code:'APPLE_REAUTH_REQUIRED'});
  const recent=jwt.verify(users.signToken(u,u.subject),process.env.JWT_SECRET);
  assert.equal(recent.auth_provider,'apple');
  await assert.rejects(apple.requestDeletion(u.id,{...recent,auth_time:recent.auth_time-301},{confirm:true}),{code:'APPLE_REAUTH_REQUIRED'});
  await assert.rejects(apple.requestDeletion(u.id,{...recent,auth_time:recent.auth_time+3600},{confirm:true}),{code:'APPLE_REAUTH_REQUIRED'});
  await assert.rejects(apple.requestDeletion(u.id,{...recent,apple_sub:'another-subject'},{confirm:true}),{status:403});
  await assert.rejects(apple.requestDeletion(u.id,recent,{confirm:false}),{status:400});
  assert.equal(processed,0);
  assert.equal((await apple.requestDeletion(u.id,recent,{confirm:true})).deletionStatus,'requested');
  const job=(await db.query('SELECT * FROM account_deletions WHERE user_id=$1',[u.id])).rows[0];assert.equal(job.subscription_id,u.stripe_subscription_id);assert.equal(job.stripe_done,false);
  assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[u.id])).rows[0].is_active,false);
  assert.equal(processed,1);
 }finally{await cleanup(u);}
});
test('older Apple sessions require the same linked Apple identity and a single-use challenge',async()=>{
 const u=await create(),other=await create();let nonce;
 try{
  const session=jwt.verify(users.signToken(u),process.env.JWT_SECRET);
  nonce=await apple.challenge();
  await assert.rejects(apple.requestDeletion(u.id,session,{confirm:true,nonce,identityToken:signed(other.subject,nonce)}),{status:403});
  assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[u.id])).rows[0].is_active,true);
  assert.equal((await db.query('SELECT 1 FROM account_deletions WHERE user_id=$1',[u.id])).rowCount,0);
  assert.equal((await apple.requestDeletion(u.id,session,{confirm:true,nonce,identityToken:signed(u.subject,nonce)})).deletionStatus,'requested');
  await assert.rejects(apple.requestDeletion(u.id,session,{confirm:true,nonce,identityToken:signed(u.subject,nonce)}),{status:401});
  assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[other.id])).rows[0].is_active,true);
 }finally{if(nonce)await db.query('DELETE FROM apple_auth_challenges WHERE id=$1',[nonce]);await cleanup(u);await cleanup(other);}
});

test('HTTP requires a valid user session, derives the method on the server, and ignores forged freshness in the body',async()=>{
 const express=require('express');const app=express();app.use(express.json());app.use('/users',require('../routes/users.routes'));app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;const u=await create();
 // Keep Apple's JWKS fetch stub separate from real local HTTP requests.
 const localFetch=oldFetch;
 const request=async(path,token,body)=>{const r=await localFetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try {
  assert.equal((await request('/users/me/deletion-method')).status,401);
  const normal=users.signToken(u);
  assert.equal((await request('/users/me/deletion-method',normal)).body.method,'apple');
  const forged=await request('/users/apple/delete',normal,{confirm:true,auth_provider:'apple',auth_time:Math.floor(Date.now()/1000),apple_sub:u.subject});
  assert.equal(forged.status,409);assert.equal(forged.body.code,'APPLE_REAUTH_REQUIRED');
  assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[u.id])).rows[0].is_active,true);
  const success=await request('/users/apple/delete',users.signToken(u,u.subject),{confirm:true});
  assert.equal(success.status,202);assert.equal(success.body.success,true);
  assert.equal((await request('/users/me/deletion-method',normal)).status,403);
 }finally{await new Promise(r=>server.close(r));await cleanup(u);}
});
