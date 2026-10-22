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
 const roleIds={};
 for(const [key,role] of [['one','executive'],['two','executive'],['admin','admin'],['editor','editor']]){
  const id=(await db.query('INSERT INTO admins(name,email,password_hash,role,is_active) VALUES($1,$2,$3,$4,TRUE) RETURNING id',[key,`${key}-${Date.now()}@draft.test`,'unused-test-hash',role])).rows[0].id;ids.push(id);roleIds[key]=id;
 }
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
 const api=async(path,actor='one',method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign({id:roleIds[actor],type:'staff'},process.env.JWT_SECRET)},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const body={title:'Executive draft local',category:'Food',tags:['Food'],region:'NY',access:'free',image:'https://example.test/photo.jpg',images:['https://example.test/photo.jpg'],isPublished:false};
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
  assert.equal((await db.query('SELECT 1 FROM experiences WHERE id=$1',['draft-'+draft.id])).rowCount,0);
  assert.ok((await db.query('SELECT 1 FROM partner_mail WHERE dedupe_key LIKE $1',[`experience-review:${draft.id}:1:%`])).rowCount>=1);
  assert.equal((await api(path+'/return','admin','POST',{note:'Ajustar texto'})).body.review_note,'Ajustar texto');
  assert.equal((await api(path,'one','PUT',{...body,title:'Ready draft'})).status,200);
  await api(path+'/submit','one','POST',{});
  const approved=await api(path+'/approve','admin','POST',{});assert.equal(approved.status,200);assert.equal(approved.body.status,'approved');
  const exp=(await db.query('SELECT * FROM experiences WHERE id=$1',[approved.body.experience_id])).rows[0];assert.equal(exp.is_published,true);assert.equal(exp.title,'Ready draft');
  assert.equal((await api(path+'/approve','admin','POST',{})).status,409);
  assert.equal((await api(path,'one','PUT',body)).status,409);
 }finally{
  if(draft){await db.query('DELETE FROM partner_mail WHERE dedupe_key LIKE $1',[`experience-review:${draft.id}:%`]);await db.query('DELETE FROM experience_drafts WHERE id=$1',[draft.id]);await db.query('DELETE FROM experiences WHERE id=$1',['draft-'+draft.id]);}
  await db.query('DELETE FROM admins WHERE id=ANY($1::int[])',[ids]);
 }
});
