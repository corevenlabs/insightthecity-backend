const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const jwt=require('jsonwebtoken');
const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'local-test',alg:'RS256',use:'sig'};
const oldFetch=global.fetch;
global.fetch=async url=>{assert.equal(url,'https://appleid.apple.com/auth/keys');return {ok:true,json:async()=>({keys:[jwk]})};};
const apple=require('../services/apple-auth.service');
const nonce='a'.repeat(64);
function token(payload={},options={}) {return jwt.sign({sub:'apple-user',nonce,email:'private@privaterelay.appleid.com',email_verified:'true',...payload},privateKey,{algorithm:'RS256',keyid:'local-test',issuer:'https://appleid.apple.com',audience:'com.insightthecity.app',expiresIn:300,...options});}
test('Apple verifies signed native credentials and private relay email',async()=>{const result=await apple.verify(token(),nonce);assert.equal(result.sub,'apple-user');});
test('Apple rejects nonce replay against a different challenge',async()=>{await assert.rejects(apple.verify(token(), 'b'.repeat(64)),{status:401});});
test('Apple rejects another application audience',async()=>{await assert.rejects(apple.verify(token({}, {audience:'another.app'}),nonce),{status:401});});
test('Apple rejects forged and expired credentials',async()=>{await assert.rejects(apple.verify(jwt.sign({nonce},'attacker',{algorithm:'HS256'}),nonce),{status:401});await assert.rejects(apple.verify(token({}, {expiresIn:-1}),nonce),{status:401});});
test('Apple rejects malformed input before key lookup',async()=>{await assert.rejects(apple.verify(null,nonce),{status:400});});
after(()=>{global.fetch=oldFetch;require('../config/db').end();});
test('Apple account lifecycle preserves an existing member and consumes challenges once',async()=>{
 const db=require('../config/db'); const tokens=require('../services/apple-tokens.service');
 const originalConnect=db.connect, originalExchange=tokens.exchange;
 process.env.JWT_SECRET='local-test-only-apple-session';
 const member={id:42,name:'Member',email:'existing@example.test',is_active:true,is_premium:true,subscription_status:'active'};
 let consumed=false;
 db.connect=async()=>({release(){},async query(sql,values){
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[],rowCount:0};
   if(sql.startsWith('SELECT id FROM apple_auth_challenges'))return {rows:consumed?[]:[{id:nonce}],rowCount:consumed?0:1};
   if(sql.startsWith('SELECT u.*'))return {rows:[member],rowCount:1};
   if(sql.startsWith('UPDATE apple_auth_identities'))return {rows:[],rowCount:1};
   if(sql.startsWith('DELETE FROM apple_auth_challenges')){consumed=true;return {rows:[],rowCount:1};}
   throw new Error(`Unexpected SQL: ${sql}`);
 }});
 tokens.exchange=async()=>({encrypted:'test-only',identityToken:token()});
 try {
  const result=await apple.authenticate({identityToken:token(),authorizationCode:'one-use-code',nonce});
  assert.equal(result.user.id,42);assert.equal(result.user.is_premium,true);assert.equal(result.user.subscription_status,'active');
  await assert.rejects(apple.authenticate({identityToken:token(),nonce}),{status:401});
  consumed=false;member.is_active=false;
  await assert.rejects(apple.authenticate({identityToken:token(),nonce}),{status:403});
  member.is_active=true;
  await assert.rejects(apple.authenticate({identityToken:token(),nonce},99),{status:409});
 } finally { db.connect=originalConnect;tokens.exchange=originalExchange; }
});
test('Apple refresh token storage is authenticated encryption',()=>{
 const tokens=require('../services/apple-tokens.service');
 process.env.APPLE_TOKEN_ENCRYPTION_KEY='c'.repeat(64);
 const encrypted=tokens.seal('private-refresh-token');
 assert.equal(tokens.open(encrypted),'private-refresh-token');
 assert.ok(!encrypted.includes('private-refresh-token'));
 const altered=Buffer.from(encrypted,'base64');altered[30]^=1;
 assert.throws(()=>tokens.open(altered.toString('base64')));
 delete process.env.APPLE_TOKEN_ENCRYPTION_KEY;
});
test('Apple production encryption uses the existing JWT secret with a separate derived key',()=>{
 const tokens=require('../services/apple-tokens.service');
 delete process.env.APPLE_TOKEN_ENCRYPTION_KEY;
 const original=process.env.JWT_SECRET;
 process.env.JWT_SECRET='local-test-only-stable-managed-secret';
 const encrypted=tokens.seal('test-refresh-token');
 assert.equal(tokens.open(encrypted),'test-refresh-token');
 process.env.JWT_SECRET='different-local-test-secret';
 assert.throws(()=>tokens.open(encrypted));
 if(original===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=original;
});
