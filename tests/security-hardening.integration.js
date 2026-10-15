const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),crypto=require('crypto'),jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs');
if(process.env.DB_DATABASE!=='itc_crm_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated DB only');
process.env.JWT_SECRET='isolated-security-test';process.env.OPENAI_API_KEY='never-call-in-tests';
const db=require('../config/db'),mail=require('../services/password-reset-mail.service');
const messages=[];mail.isConfigured=()=>true;mail.send=async m=>messages.push(m);
let server;const fixtureIds=[];
after(async()=>{if(server){server.closeIdleConnections();await new Promise(r=>server.close(r));}for(const id of fixtureIds)await db.query('DELETE FROM users WHERE id=$1',[id]);await db.end();});
let base;
test('bootstrap isolated security test schema',async()=>{
 for(const file of ['schema.sql','partner-crm.sql','account-deletion.sql','legal-evidence.sql','private-avatars.sql','web-account-deletion.sql','security-hardening.sql'])await db.query(fs.readFileSync('database/'+file,'utf8'));
 server=require('../server').listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
const post=(path,data,token,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify(data)});
test('password reset revokes old sessions, permits fresh login and preserves account data',async()=>{
 const email=`security-${Date.now()}@example.test`;
 const user=(await db.query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING *',['Owner',email,await bcrypt.hash('old-password',10)])).rows[0];fixtureIds.push(user.id);
 const old=jwt.sign({id:user.id,type:'user'},process.env.JWT_SECRET);
 assert.equal((await fetch(base+'/api/users/me',{headers:{Authorization:'Bearer '+old}})).status,200);
 assert.equal((await post('/api/users/password-reset/request',{email})).status,200);
 const code=messages.at(-1).text.match(/\b\d{8}\b/)[0];
 assert.equal((await post('/api/users/password-reset/confirm',{email,code,password:'new-password'})).status,200);
 assert.equal((await fetch(base+'/api/users/me',{headers:{Authorization:'Bearer '+old}})).status,401);
 const login=await post('/api/users/login',{email,password:'new-password'});assert.equal(login.status,200);const result=await login.json();assert.equal(jwt.decode(result.token).sv,1);
 const me=await fetch(base+'/api/users/me',{headers:{Authorization:'Bearer '+result.token}});assert.equal(me.status,200);assert.equal((await me.json()).user.name,'Owner');
 assert.equal((await post('/api/users/password-reset/confirm',{email,code,password:'replay-password'})).status,400);
});
test('rate counters are shared atomically across servers and store no plaintext identity',async()=>{
 const express=require('express'),{limit}=require('../middleware/security-rate-limit');const scope=crypto.randomUUID(),servers=[];
 try{
  for(let i=0;i<2;i++){const app=express();app.get('/',limit(scope,2,60,()=> 'private-email@example.test'),(_q,r)=>r.json({ok:true}));const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));servers.push(s);}
  const responses=await Promise.all(Array.from({length:10},(_,i)=>fetch(`http://127.0.0.1:${servers[i%2].address().port}/`)));
  assert.equal(responses.filter(r=>r.status===200).length,2);assert.equal(responses.filter(r=>r.status===429).length,8);assert.ok(Number(responses.find(r=>r.status===429).headers.get('retry-after'))>0);
  const hashes=(await db.query('SELECT key_hash FROM security_rate_limits')).rows;assert.ok(hashes.every(r=>/^[a-f0-9]{64}$/.test(r.key_hash)));
 }finally{for(const s of servers){s.closeIdleConnections();await new Promise(r=>s.close(r));}}
});
test('normal login is accepted but excessive attempts on one account are throttled without blocking another account',async()=>{
 const email=`rate-${Date.now()}@example.test`;
 let response;for(let i=0;i<21;i++)response=await post('/api/users/login',{email,password:'incorrect'});
 assert.equal(response.status,429);assert.ok(response.headers.get('retry-after'));
 assert.equal((await post('/api/users/login',{email:'other-'+email,password:'incorrect'})).status,401);
 assert.equal((await post('/api/users/login',{email:{bad:true},password:'x'})).status,400);
});
test('CORS and headers protect the browser while native apps and approved panel still work',async()=>{
 const r=await fetch(base+'/health');assert.equal(r.status,200);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('x-powered-by'),null);
 const panel=await fetch(base+'/health',{headers:{Origin:'https://itc-panel-1031252664334.us-east1.run.app'}});assert.equal(panel.status,200);assert.equal(panel.headers.get('access-control-allow-origin'),'https://itc-panel-1031252664334.us-east1.run.app');
 const denied=await fetch(base+'/health',{headers:{Origin:'https://untrusted.example'}});assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
 const image=await fetch(base+'/email-assets/itc-club-logo-v1.png');assert.equal(image.status,200);assert.equal(image.headers.get('cross-origin-resource-policy'),'cross-origin');
 assert.equal((await fetch(base+'/uploads/avatars/1/private.jpg')).status,404);assert.equal((await fetch(base+'/uploads/guides/private.pdf')).status,404);
 assert.equal((await post('/api/places',{message:'New York'})).status,401);
});
test('chat enforces a quota before expensive calls and rejects invalid messages',async()=>{
 const id=fixtureIds[0],row=(await db.query('SELECT session_version FROM users WHERE id=$1',[id])).rows[0];
 const token=jwt.sign({id,type:'user',sv:row.session_version},process.env.JWT_SECRET);
 assert.equal((await post('/api/chat',{message:'x'.repeat(801)},token)).status,400);
 assert.equal((await post('/api/places',{message:'x'.repeat(301)},token)).status,400);
 const {limit,user}=require('../middleware/security-rate-limit');
 // Consume the real chat scope quota directly without invoking OpenAI or Places.
 for(let i=0;i<20;i++)await new Promise((resolve,reject)=>limit('chat-minute',20,60,user)({user:{id}}, {set(){return this;},status(){return this;},json(){resolve();}},e=>e?reject(e):resolve()));
 assert.equal((await post('/api/chat',{message:'hello'},token)).status,429);
});
test('public image upload rejects disguised files, canonicalizes valid files and preserves billing checkout',async()=>{
 const staff=(await db.query("INSERT INTO admins(email,password_hash,role) VALUES($1,$2,'admin') RETURNING id,session_version",[`upload-${Date.now()}@example.test`,await bcrypt.hash('staff-password',10)])).rows[0];
 const token=jwt.sign({id:staff.id,type:'staff',sv:staff.session_version},process.env.JWT_SECRET);
 const upload=require('../services/uploads.service'),originalUpload=upload.uploadImage;
 // Controller imports the upload function, so use the local upload driver and delete only generated test files.
 const before=require('path').join(__dirname,'..','uploads','experiences');let published;
 try{
  const bad=new FormData();bad.append('file',new Blob(['<svg onload="alert(1)">'],{type:'image/png'}),'fake.png');
  assert.equal((await fetch(base+'/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+token},body:bad})).status,400);
  const valid=new FormData();valid.append('file',new Blob([Buffer.from([255,216,255,0])],{type:'image/jpeg'}),'unsafe.html');
  const response=await fetch(base+'/api/uploads',{method:'POST',headers:{Authorization:'Bearer '+token},body:valid});assert.equal(response.status,200);published=(await response.json()).url;assert.match(published,/\.jpg$/);assert.ok(!published.includes('.html'));
  const stripe=require('../services/stripe.service');const original={getPlan:stripe.getPlan,ensureCustomer:stripe.ensureCustomer,create:stripe.createCheckoutSession};
  try{
   stripe.getPlan=async()=>({amountCents:499,currency:'usd',interval:'month'});stripe.ensureCustomer=async()=> 'cus_security_test';stripe.createCheckoutSession=async args=>{assert.equal(args.user.id,fixtureIds[0]);assert.ok(args.renewalNotice);return {id:'cs_test_security',url:'https://checkout.stripe.com/test-security'};};
   const sv=(await db.query('SELECT session_version FROM users WHERE id=$1',[fixtureIds[0]])).rows[0].session_version;
   const userToken=jwt.sign({id:fixtureIds[0],type:'user',sv},process.env.JWT_SECRET);
   const response=await post('/api/payment/create-subscription',{autorenewConsent:true,returnUrl:'itcclub://checkout-return'},userToken);assert.equal(response.status,200);assert.equal((await response.json()).sessionId,'cs_test_security');
  }finally{stripe.getPlan=original.getPlan;stripe.ensureCustomer=original.ensureCustomer;stripe.createCheckoutSession=original.create;}
 }finally{
  await db.query('DELETE FROM admins WHERE id=$1',[staff.id]);
  if(published){const filename=require('path').basename(new URL(published).pathname);fs.rmSync(require('path').join(before,filename),{force:true});}
  upload.uploadImage=originalUpload;
 }
});
test('registration, staff login and legitimate benefit issuance still work with the new protections',async()=>{
 const email=`signup-${Date.now()}@example.test`;
 const registered=await post('/api/users/register',{name:'Security QA',email,password:'secure-password',language:'en',acceptLegal:true});assert.equal(registered.status,201);
 const data=await registered.json();fixtureIds.push(data.user.id);assert.ok(data.token);
 await db.query('UPDATE users SET is_premium=TRUE WHERE id=$1',[data.user.id]);
 const experienceId=`security-benefit-${Date.now()}`;
 const staff=(await db.query("INSERT INTO admins(email,password_hash,role) VALUES($1,$2,'admin') RETURNING id",[`staff-security-${Date.now()}@example.test`,await bcrypt.hash('staff-password',10)])).rows[0];
 const staffEmail=(await db.query('SELECT email FROM admins WHERE id=$1',[staff.id])).rows[0].email;
 try{
  const login=await post('/api/auth/login',{email:staffEmail,password:'staff-password'});assert.equal(login.status,200);const account=await login.json();assert.equal(jwt.decode(account.token).sv,0);
  assert.equal((await fetch(base+'/api/staff/me',{headers:{Authorization:'Bearer '+account.token}})).status,200);
  await db.query('UPDATE admins SET session_version=session_version+1 WHERE id=$1',[staff.id]);
  assert.equal((await fetch(base+'/api/staff/me',{headers:{Authorization:'Bearer '+account.token}})).status,401);
  const fresh=await post('/api/auth/login',{email:staffEmail,password:'staff-password'});assert.equal(fresh.status,200);assert.equal(jwt.decode((await fresh.json()).token).sv,1);
  await db.query("INSERT INTO experiences(id,title,category,access,is_published,benefit_action,member_benefit,coupon_active,coupon_inventory_mode,coupon_per_user) VALUES($1,'Security benefit','FOOD','premium',TRUE,'qr','Test benefit',TRUE,'unlimited',1)",[experienceId]);
  const issue=await post(`/api/benefits/${experienceId}/code`,{},data.token);assert.equal(issue.status,201);const issued=await issue.json();assert.ok(issued);
 }finally{await db.query('DELETE FROM experiences WHERE id=$1',[experienceId]);await db.query('DELETE FROM admins WHERE id=$1',[staff.id]);}
});
test('editing profile fields preserves sessions; deactivation and reactivation revoke them',async()=>{
 const id=fixtureIds[0],users=require('../services/users.service');
 const before=(await db.query('SELECT session_version FROM users WHERE id=$1',[id])).rows[0].session_version;
 const token=jwt.sign({id,type:'user',sv:before},process.env.JWT_SECRET);
 await users.adminUpdate(id,{name:'Updated owner',is_active:true});
 assert.equal((await db.query('SELECT session_version FROM users WHERE id=$1',[id])).rows[0].session_version,before);
 assert.equal((await fetch(base+'/api/users/me',{headers:{Authorization:'Bearer '+token}})).status,200);
 await users.adminUpdate(id,{is_active:false});assert.equal((await fetch(base+'/api/users/me',{headers:{Authorization:'Bearer '+token}})).status,403);
 await users.adminUpdate(id,{is_active:true});assert.equal((await fetch(base+'/api/users/me',{headers:{Authorization:'Bearer '+token}})).status,401);
 const login=await post('/api/users/login',{email:(await db.query('SELECT email FROM users WHERE id=$1',[id])).rows[0].email,password:'new-password'});assert.equal(login.status,200);
});
