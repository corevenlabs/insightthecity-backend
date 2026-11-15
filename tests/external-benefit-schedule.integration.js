// All writes are fixtures in a fresh local test database, never production.
const {test,after}=require('node:test');const assert=require('node:assert/strict');
if(process.env.DB_HOST!=='127.0.0.1'||!/^itc_external_benefit_test_[a-z0-9_]+$/.test(process.env.DB_DATABASE||''))throw Error('Isolated local external-benefit database only');
process.env.JWT_SECRET='external-benefit-local-test-only';process.env.PUBLIC_BASE_URL='https://itc.example.test';
const db=require('../config/db'),jwt=require('jsonwebtoken'),express=require('express');
const app=express();app.use(express.json());app.use('/experiences',require('../routes/experiences.routes'));app.use('/drafts',require('../routes/experience-drafts.routes'));app.get('/benefits/link/:id',require('../controllers/external-benefit-link.controller').show);app.use(require('../middleware/manejadorErrores'));
let server;after(async()=>{if(server)await new Promise(r=>server.close(r));await db.end();});
test('external dates persist, public links are gated, admin retains source URL, and QR data is unchanged',async()=>{
 const id=(await db.query("INSERT INTO admins(name,email,password_hash,role) VALUES('Admin','external-admin@example.test','test-only','admin') RETURNING id")).rows[0].id;
 const token=jwt.sign({id,type:'staff'},process.env.JWT_SECRET);
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const api=async(path,method='GET',body,staff=true)=>{
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(staff?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
 };
 const body={title:'External fixture',tags:['BROADWAY'],access:'premium',region:'NY',images:[1,2,3,4].map(n=>'https://example.test/'+n+'.jpg'),description:'Original descripción 🎭',memberBenefit:'Special offer',benefitAction:'external',benefitUrl:'https://partner.example/pay?coupon=KEEP100&ref=x%2Fy',isPublished:true};
 const qr=(await api('/experiences','POST',{...body,title:'QR fixture',benefitAction:'qr',benefitUrl:null,couponActive:true,couponInventoryMode:'limited',couponTotal:50,couponPerUser:2,couponStartsAt:'2026-01-01T00:00:00Z',couponEndsAt:'2030-01-01T00:00:00Z'})).body;
 const qrBefore=(await db.query('SELECT * FROM experiences WHERE id=$1',[qr.id])).rows[0];
 const created=await api('/experiences','POST',body);assert.equal(created.status,201,JSON.stringify(created.body));const exp=created.body;
 let publicExp=await api('/experiences/'+exp.id+'?lang=es','GET',undefined,false);assert.equal(publicExp.body.benefitUrl,body.benefitUrl);
 const now=Date.now();const starts=new Date(now+3600000).toISOString(),ends=new Date(now+7200000).toISOString();
 const updated=await api('/experiences/'+exp.id,'PUT',{externalBenefitStartsAt:starts,externalBenefitEndsAt:ends});assert.equal(updated.status,200,JSON.stringify(updated.body));
 assert.equal(updated.body.externalBenefitStartsAt,starts);assert.equal(updated.body.benefitUrl,body.benefitUrl);
 publicExp=await api('/experiences/'+exp.id+'?lang=es','GET',undefined,false);assert.match(publicExp.body.benefitUrl,/\/benefits\/link\//);assert.doesNotMatch(publicExp.body.benefitUrl,/KEEP100/);
 const gate=new URL(publicExp.body.benefitUrl);const localGate=base+gate.pathname+gate.search;
 let r=await fetch(localGate,{redirect:'manual'});assert.equal(r.status,200);assert.match(await r.text(),/Próximamente/);assert.equal(r.headers.get('location'),null);
 const edit=await api('/experiences/'+exp.id+'?view=admin');assert.equal(edit.body.benefitUrl,body.benefitUrl);assert.equal(edit.body.externalBenefitStartsAt,starts);
 assert.equal((await api('/experiences/'+exp.id+'?view=admin','GET',undefined,false)).status,401);
 const list=await api('/experiences?published=all');assert.equal(list.body.find(x=>x.id===exp.id).benefitUrl,body.benefitUrl);
 const rollback=await api('/experiences/'+exp.id,'PUT',{title:'Should not be saved',externalBenefitEndsAt:new Date(now).toISOString()});assert.equal(rollback.status,400);assert.equal((await db.query('SELECT title FROM experiences WHERE id=$1',[exp.id])).rows[0].title,body.title);
 assert.equal((await api('/experiences/'+exp.id,'PUT',{...body,benefitUrl:publicExp.body.benefitUrl})).status,400);
 assert.equal((await api('/experiences/'+exp.id,'PUT',{externalBenefitStartsAt:'2026-02-30T00:00:00Z'})).status,400);
 await api('/experiences/'+exp.id,'PUT',{externalBenefitStartsAt:new Date(now-3600000).toISOString()});
 r=await fetch(localGate,{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),body.benefitUrl);
 await api('/experiences/'+exp.id,'PUT',{externalBenefitEndsAt:new Date(now-1000).toISOString()});
 r=await fetch(localGate,{redirect:'manual'});assert.equal(r.status,410);assert.match(await r.text(),/Beneficio finalizado/);
 await api('/experiences/'+exp.id,'PUT',{externalBenefitStartsAt:null,externalBenefitEndsAt:null});
 r=await fetch(localGate,{redirect:'manual'});assert.equal(r.status,303);
 await api('/experiences/'+exp.id,'PUT',{isPublished:false});assert.equal((await fetch(localGate,{redirect:'manual'})).status,404);
 // Standalone drafts also retain the external dates until administrator approval.
 const draft=await api('/drafts','POST',{...body,title:'Scheduled draft',isPublished:false,externalBenefitStartsAt:starts,externalBenefitEndsAt:ends});assert.equal(draft.status,201);
 const approved=await api('/drafts/'+draft.body.id+'/approve','POST',{});assert.equal(approved.status,200,JSON.stringify(approved.body));
 const stored=(await db.query('SELECT * FROM experiences WHERE id=$1',[approved.body.experience_id])).rows[0];assert.equal(stored.external_benefit_starts_at.toISOString(),starts);assert.equal(stored.benefit_url,body.benefitUrl);
 const qrAfter=(await db.query('SELECT * FROM experiences WHERE id=$1',[qr.id])).rows[0];assert.deepEqual(qrAfter,qrBefore);
});
