// Isolated local PostgreSQL only; no real Google accounts, email or payments.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {OAuth2Client}=require('google-auth-library');
const bcrypt=require('bcryptjs');
if(process.env.DB_DATABASE!=='itc_crm_test'||process.env.DB_HOST!=='127.0.0.1')throw new Error('Requires isolated local itc_crm_test database');
const db=require('../config/db');
const original=OAuth2Client.prototype.verifyIdToken;
OAuth2Client.prototype.verifyIdToken=async()=>({getPayload:()=>({sub:'local-integration-google',email:'google-integration@example.test',email_verified:true})});
process.env.GOOGLE_WEB_CLIENT_ID='integration.apps.googleusercontent.com';
process.env.JWT_SECRET='local-integration-test-only';
const google=require('../services/google-auth.service');
test('Google identity links the original paid member, is unique, and is deleted with the account',async()=>{
 await db.query(fs.readFileSync('database/google-auth.sql','utf8'));
 let id;
 try {
  id=(await db.query("INSERT INTO users(name,email,password_hash,is_premium,subscription_status) VALUES('Google integration','google-integration@example.test',$1,TRUE,'active') RETURNING id",[await bcrypt.hash('local-test-password',4)])).rows[0].id;
  await assert.rejects(google.authenticate({identityToken:'local-token-for-integration'}),{code:'LINK_REQUIRED'});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM google_auth_identities WHERE user_id=$1',[id])).rows[0].n,0);
  const signed=await google.authenticate({identityToken:'local-token-for-integration',password:'local-test-password'});
  assert.equal(signed.user.id,id);assert.equal(signed.user.is_premium,true);assert.equal(signed.user.subscription_status,'active');
  const again=await google.authenticate({identityToken:'local-token-for-integration'});
  assert.equal(again.user.id,id);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM google_auth_identities WHERE user_id=$1',[id])).rows[0].n,1);
  await db.query('UPDATE users SET is_active=FALSE WHERE id=$1',[id]);
  await assert.rejects(google.authenticate({identityToken:'local-token-for-integration'}),{status:403});
  await db.query('DELETE FROM users WHERE id=$1',[id]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM google_auth_identities WHERE user_id=$1',[id])).rows[0].n,0);
 }finally{if(id)await db.query('DELETE FROM users WHERE id=$1',[id]);}
});
after(async()=>{OAuth2Client.prototype.verifyIdToken=original;await db.end();});
