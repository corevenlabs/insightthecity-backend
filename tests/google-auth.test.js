const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const {OAuth2Client}=require('google-auth-library');
const db=require('../config/db');
const legal=require('../services/legal.service');
const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const original=OAuth2Client.prototype.getFederatedSignonCertsAsync;
OAuth2Client.prototype.getFederatedSignonCertsAsync=async()=>({certs:{test:publicKey.export({type:'spki',format:'pem'})},format:'PEM'});
process.env.GOOGLE_WEB_CLIENT_ID='test.apps.googleusercontent.com';
process.env.JWT_SECRET='local-google-test-key';
const google=require('../services/google-auth.service');
function token(claims={},options={}){return jwt.sign({sub:'google-sub',email:'member@example.test',email_verified:true,name:'Member',...claims},privateKey,{algorithm:'RS256',keyid:'test',issuer:'https://accounts.google.com',audience:process.env.GOOGLE_WEB_CLIENT_ID,expiresIn:300,...options});}
test('Google accepts signed credentials for the configured backend audience',async()=>{assert.equal((await google.verify(token())).sub,'google-sub');});
test('Google rejects wrong audience, expired, forged and unverified credentials',async()=>{
 for(const t of [token({}, {audience:'attacker.apps.googleusercontent.com'}),token({}, {expiresIn:-400}),jwt.sign({sub:'attacker'},'bad'),token({email_verified:false}),token({sub:''})])await assert.rejects(google.verify(t),{status:401});
 await assert.rejects(google.verify(null),{status:400});
});
test('Google fails closed when the backend client ID is missing',async()=>{const id=process.env.GOOGLE_WEB_CLIENT_ID;delete process.env.GOOGLE_WEB_CLIENT_ID;try{await assert.rejects(google.verify('x'.repeat(30)),{status:503});}finally{process.env.GOOGLE_WEB_CLIENT_ID=id;}});
test('Google linking preserves member ID and subscription; new accounts require legal acceptance',async()=>{
 const originalConnect=db.connect,originalLegal=legal.recordAcceptance;
 const member={id:42,name:'Member',email:'member@example.test',password_hash:await bcrypt.hash('correct-password',4),is_active:true,is_premium:true,subscription_status:'active'};
 let linked=false,existing=member,legalCount=0,inserts=0;
 db.connect=async()=>({release(){},async query(sql,values){
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory'))return {rows:[]};
  if(sql.startsWith('SELECT u.*'))return {rows:linked?[member]:[]};
  if(sql.startsWith('SELECT * FROM users'))return {rows:existing?[existing]:[]};
  if(sql.startsWith('INSERT INTO users')){inserts++;return {rows:[{...member,id:99,is_premium:false,password_hash:null,language:values[2]}]};}
  if(sql.startsWith('INSERT INTO google_auth_identities')){linked=true;return {rows:[]};}
  throw new Error('Unexpected SQL: '+sql);
 }});
 legal.recordAcceptance=async()=>{legalCount++;};
 try{
  await assert.rejects(google.authenticate({identityToken:token()}),{code:'LINK_REQUIRED'});
  assert.equal(linked,false);
  await assert.rejects(google.authenticate({identityToken:token(),password:'incorrect'}),{status:401});
  const result=await google.authenticate({identityToken:token(),password:'correct-password'});
  assert.equal(result.user.id,42);assert.equal(result.user.is_premium,true);assert.equal(result.user.subscription_status,'active');assert.equal(inserts,0);
  assert.equal((await google.authenticate({identityToken:token()})).user.id,42);
  member.is_active=false;await assert.rejects(google.authenticate({identityToken:token()}),{status:403});member.is_active=true;
  linked=false;existing=null;
  await assert.rejects(google.authenticate({identityToken:token()}),{code:'REGISTRATION_REQUIRED'});assert.equal(inserts,0);
  const created=await google.authenticate({identityToken:token(),acceptLegal:true,language:'pt'});
  assert.equal(created.user.id,99);assert.equal(created.user.is_premium,false);assert.equal(legalCount,1);
 }finally{db.connect=originalConnect;legal.recordAcceptance=originalLegal;}
});
after(async()=>{OAuth2Client.prototype.getFederatedSignonCertsAsync=original;await db.end();});
