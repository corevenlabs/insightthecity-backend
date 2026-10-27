const {test,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),jwt=require('jsonwebtoken');
if(process.env.DB_DATABASE!=='itc_crm_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated local DB only');
process.env.JWT_SECRET='draft-review-local-only';
const db=require('../config/db');
require('../services/password-reset-mail.service').isConfigured=()=>false;
const express=require('express');const app=express();app.use(express.json());app.use('/drafts',require('../routes/experience-drafts.routes'));app.use('/experiences',require('../routes/experiences.routes'));app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
let server,base;const ids=[];
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.end();});
test('executive without clients creates own drafts, submits, admin returns and publishes once',async()=>{
 await db.query(fs.readFileSync('database/experience-drafts.sql','utf8'));
 await db.query(fs.readFileSync('database/experience-draft-activity.sql','utf8'));
 await db.query(fs.readFileSync('database/partner-publications.sql','utf8'));
 await db.query(fs.readFileSync('database/experience-draft-activity.sql','utf8'));
 const roleIds={};
 for(const [key,role] of [['one','executive'],['two','executive'],['admin','admin'],['editor','editor']]){
  const id=(await db.query('INSERT INTO admins(name,email,password_hash,role,is_active) VALUES($1,$2,$3,$4,TRUE) RETURNING id',[key,`${key}-${Date.now()}@draft.test`,'unused-test-hash',role])).rows[0].id;ids.push(id);roleIds[key]=id;
 }
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
 const api=async(path,actor='one',method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign({id:roleIds[actor],type:'staff'},process.env.JWT_SECRET)},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const body={instagramUrl:'https://www.instagram.com/testbusiness/',tiktokUrl:'https://www.tiktok.com/@testbusiness',facebookUrl:'https://www.facebook.com/testbusiness/',title:'Executive draft local',category:'Food',tags:['Food'],region:'NY',access:'free',image:'https://example.test/photo.jpg',images:['https://example.test/photo.jpg'],isPublished:false};
 let draft;
 try{
  assert.equal((await api('/drafts','editor')).status,403);
  assert.equal((await api('/drafts','one','POST',{...body,isPublished:true})).status,403);
  const created=await api('/drafts','one','POST',body);assert.equal(created.status,201);draft=created.body;
  assert.equal(draft.owner_id,roleIds.one);assert.equal(draft.status,'draft');
  assert.equal((await api('/drafts','two')).body.length,0);
  assert.equal((await api('/drafts/'+draft.id,'two')).status,404);
  assert.equal((await api('/drafts/'+draft.id,'two','PUT',body)).status,404);
  assert.equal((await api('/experiences','one','POST',{...body,isPublished:true})).status,403);
  const path='/drafts/'+draft.id;
  assert.equal((await api(path+'/submit','one','POST',{})).body.status,'pending');
  assert.equal((await api(path+'/submit','one','POST',{})).status,409);
  assert.equal((await api(path,'one','PUT',{...body,title:'Changed'})).status,409);
  assert.equal((await api(path+'/approve','one','POST',{})).status,403);
  assert.equal((await api(path+'/return','one','POST',{})).status,403);
  const corrected=await api(path,'admin','PUT',{...body,title:'Admin correction',owner_id:roleIds.admin});
  assert.equal(corrected.status,200);assert.equal(corrected.body.status,'pending');
  assert.equal(corrected.body.owner_id,roleIds.one);
  assert.equal(corrected.body.payload.title,'Admin correction');
  assert.equal(corrected.body.activity[0].kind,'saved');
  assert.equal(corrected.body.activity[0].actor_name,'admin');
  assert.equal((await api(path,'two','PUT',body)).status,404);
  assert.equal((await api(path,'editor','PUT',body)).status,403);
  assert.equal((await api(path,'one','PUT',body)).status,409);
  assert.equal((await db.query('SELECT 1 FROM experiences WHERE id=$1',['draft-'+draft.id])).rowCount,0);
  assert.ok((await db.query('SELECT 1 FROM partner_mail WHERE dedupe_key LIKE $1',[`experience-review:${draft.id}:1:%`])).rowCount>=1);
  assert.equal((await api(path+'/return','admin','POST',{note:'Ajustar texto'})).body.review_note,'Ajustar texto');
  assert.equal((await api(path,'one','PUT',{...body,title:'Ready draft'})).status,200);
  await api(path+'/submit','one','POST',{});
  const beforeInvalid=(await api(path,'admin')).body.activity.length;
  assert.equal((await api(path+'/approve','admin','POST',{payload:{...body,title:''}})).status,400);
  assert.equal((await api(path,'admin')).body.status,'pending');
  assert.equal((await api(path,'admin')).body.activity.length,beforeInvalid);
  const approved=await api(path+'/approve','admin','POST',{payload:{...body,title:'Final unsaved admin correction'}});assert.equal(approved.status,200);assert.equal(approved.body.status,'approved');
  const exp=(await db.query('SELECT * FROM experiences WHERE id=$1',[approved.body.experience_id])).rows[0];assert.equal(exp.is_published,true);assert.equal(exp.title,'Final unsaved admin correction');assert.equal(approved.body.payload.title,exp.title);assert.equal(approved.body.owner_id,roleIds.one);assert.equal(approved.body.reviewed_by,roleIds.admin);assert.equal(approved.body.activity[0].kind,'published');assert.equal(approved.body.activity[0].actor_name,'admin');assert.equal(exp.instagram_url,body.instagramUrl);assert.equal(exp.tiktok_url,body.tiktokUrl);assert.equal(exp.facebook_url,body.facebookUrl);
  assert.equal((await api(path+'/approve','admin','POST',{})).status,409);
  assert.equal((await api(path,'one','PUT',body)).status,409);
  assert.equal((await api('/experiences/'+exp.id,'admin','PUT',{...body,title:'Published admin edit',isPublished:true})).status,200);
  assert.equal((await api('/experiences/'+exp.id,'one','PUT',body)).status,403);
  assert.equal((await api(path,'admin')).body.owner_id,roleIds.one);
  const client=(await db.query("INSERT INTO partner_clients(business_name,contact_name,email,owner_id,category,offer,amount_cents,payment_method,payment_status,form_status) VALUES('Bound client','Owner',$1,$2,'strategic','strategic',0,'waived','waived','submitted') RETURNING *",['bound-'+Date.now()+'@example.test',roleIds.one])).rows[0];
  let bound;
  try {
    assert.equal((await api('/drafts','two','POST',{...body,client_id:client.id})).status,404);
    const createdBound=await api('/drafts','one','POST',{...body,client_id:client.id});assert.equal(createdBound.status,201);bound=createdBound.body;
    assert.equal(bound.client_id,client.id);
    assert.equal((await api('/drafts','one','POST',{...body,client_id:client.id})).status,409);
    const publishedBound=await api('/drafts/'+bound.id+'/approve','admin','POST',{payload:body,client_id:client.id});assert.equal(publishedBound.status,200);
    const linked=(await db.query('SELECT * FROM partner_clients WHERE id=$1',[client.id])).rows[0];
    assert.equal(linked.experience_id,publishedBound.body.experience_id);assert.equal(linked.owner_id,roleIds.one);assert.equal(linked.activated_at,null);assert.equal(linked.expires_at,null);assert.equal(linked.form_status,'submitted');
  } finally {
    await db.query('DELETE FROM partner_activity WHERE client_id=$1',[client.id]);
    await db.query('DELETE FROM partner_clients WHERE id=$1',[client.id]);
    if(bound){await db.query('DELETE FROM experience_drafts WHERE id=$1',[bound.id]);await db.query('DELETE FROM experiences WHERE id=$1',['draft-'+bound.id]);}
  }
  const direct=(await api('/drafts','admin','POST',body)).body;
  try {
   const published=await api('/drafts/'+direct.id+'/approve','admin','POST',{payload:{...body,title:'Admin publishes preparation directly'}});
   assert.equal(published.status,200);assert.equal(published.body.status,'approved');
   assert.equal(published.body.owner_id,roleIds.admin);
   assert.equal((await api('/drafts/'+direct.id+'/approve','admin','POST',{})).status,409);
  } finally {
   await db.query('DELETE FROM experience_drafts WHERE id=$1',[direct.id]);
   await db.query('DELETE FROM experiences WHERE id=$1',['draft-'+direct.id]);
  }
 }finally{
  if(draft){await db.query('DELETE FROM partner_mail WHERE dedupe_key LIKE $1',[`experience-review:${draft.id}:%`]);await db.query('DELETE FROM experience_drafts WHERE id=$1',[draft.id]);await db.query('DELETE FROM experiences WHERE id=$1',['draft-'+draft.id]);}
  await db.query('DELETE FROM admins WHERE id=ANY($1::int[])',[ids]);
 }
});
