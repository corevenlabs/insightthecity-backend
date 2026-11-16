const {test,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
if(process.env.DB_HOST!=='127.0.0.1'||!/^itc_private_benefit_test_[a-z0-9_]+$/.test(process.env.DB_DATABASE||''))throw Error('Isolated local DB only');
process.env.JWT_SECRET='private-benefit-integration-only';process.env.PUBLIC_BASE_URL='https://itc.example.test';
const jwt=require('jsonwebtoken'),db=require('../config/db'),express=require('express');
require('../services/content-language.service').experience=async row=>row;
const app=express();app.use(express.json());app.use('/experiences',require('../routes/experiences.routes'));app.get('/benefits/link/:id',require('../controllers/external-benefit-link.controller').show);app.use(require('../middleware/manejadorErrores'));
let server;after(async()=>{if(server)await new Promise(r=>server.close(r));await db.end();});
test('guests/free/stale/inactive users cannot retrieve code or target; only current active premium can',async()=>{
 const admin=(await db.query("INSERT INTO admins(name,email,password_hash,role) VALUES('Admin','admin-private@example.test','test','admin') RETURNING id")).rows[0];
 const users={};for(const [name,premium,active]of[['premium',true,true],['free',false,true],['inactive',true,false]])users[name]=(await db.query('INSERT INTO users(name,email,is_premium,is_active) VALUES($1,$2,$3,$4) RETURNING *',[name,name+'@example.test',premium,active])).rows[0];
 const bearer=(u,extra={})=>jwt.sign({id:u.id,type:'user',sv:Number(u.session_version||0),...extra},process.env.JWT_SECRET,{expiresIn:'1h'});
 const adminToken=jwt.sign({id:admin.id,type:'staff'},process.env.JWT_SECRET);
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const api=async(path,token,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json()};};
 const code='PRIVATE987';const body={title:'Private venue',tags:['BROADWAY'],access:'premium',region:'NY',images:[1,2,3,4].map(n=>'https://example.test/'+n+'.jpg'),memberBenefit:'Member offer',privateBenefitCode:code,memberBenefitDetails:'Up to eight tickets',benefitAction:'external',benefitUrl:'https://partner.example/pay?coupon='+code,isPaidEvent:true,ticketUrl:'https://partner.example/tickets?code='+code,isPublished:true};
 const created=await api('/experiences',adminToken,'POST',body);assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.privateBenefitCode,code);const id=created.body.id;
 // Emulate historic public fields and prove migration + runtime redaction protect them.
 await db.query('UPDATE experiences SET private_benefit_code=NULL,member_benefit=$2,member_benefit_details=$3 WHERE id=$1',[id,'COD: '+code,'Use '+code+' for eight tickets']);
 await db.query(fs.readFileSync('database/private-benefit-code.sql','utf8'));
 assert.equal((await db.query('SELECT private_benefit_code FROM experiences WHERE id=$1',[id])).rows[0].private_benefit_code,code);
 for(const token of [null,bearer(users.free,{is_premium:true}),bearer(users.inactive),'invalid',jwt.sign({id:users.premium.id,type:'user',sv:0},process.env.JWT_SECRET,{expiresIn:-1})]){
  for(const lang of ['es','en','pt']){
   const r=await api('/experiences/'+id+'?lang='+lang,token);assert.equal(r.status,200);assert.doesNotMatch(JSON.stringify(r.body),new RegExp(code));assert.equal(r.body.benefitUrl,null);assert.equal(r.body.ticketUrl,null);assert.equal(r.body.privateBenefitRequired,true);
  }
 }
 const premiumToken=bearer(users.premium);const premium=await api('/experiences/'+id,premiumToken);assert.equal(premium.body.privateBenefitCode,code);assert.doesNotMatch(premium.body.memberBenefitDetails,new RegExp(code));
 for(const token of [null,premiumToken]){const list=await api('/experiences',token);assert.doesNotMatch(JSON.stringify(list.body),new RegExp(code));}
 const edit=await api('/experiences/'+id+'?view=admin',adminToken);assert.equal(edit.body.privateBenefitCode,code);assert.equal(edit.body.benefitUrl,body.benefitUrl);
 const url=new URL(premium.body.benefitUrl);const path=url.pathname+url.search;
 let r=await fetch(base+path,{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),body.benefitUrl);
 assert.equal((await fetch(base+url.pathname,{redirect:'manual'})).status,403);
 assert.equal((await fetch(base+url.pathname+'?grant='+premiumToken,{redirect:'manual'})).status,403);
 const wrong=new URL(premium.body.ticketUrl);wrong.searchParams.set('target','benefit');assert.equal((await fetch(base+wrong.pathname+wrong.search,{redirect:'manual'})).status,404);
 await db.query('UPDATE users SET is_premium=FALSE WHERE id=$1',[users.premium.id]);assert.equal((await fetch(base+path,{redirect:'manual'})).status,403);assert.equal((await api('/experiences/'+id,premiumToken)).body.privateBenefitCode,undefined);
 await db.query('UPDATE users SET is_premium=TRUE,session_version=session_version+1 WHERE id=$1',[users.premium.id]);assert.equal((await fetch(base+path,{redirect:'manual'})).status,403);assert.equal((await api('/experiences/'+id,premiumToken)).body.privateBenefitCode,undefined);
 const renewed=(await db.query('SELECT * FROM users WHERE id=$1',[users.premium.id])).rows[0];assert.equal((await api('/experiences/'+id,bearer(renewed))).body.privateBenefitCode,code);
 const bad=await api('/experiences/'+id,adminToken,'PUT',{...body,memberBenefit:'Use '+code});assert.equal(bad.status,400);
});
