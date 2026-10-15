// Run only with the isolated local CRM database. No real documents are published.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const jwt=require('jsonwebtoken');
if(process.env.DB_DATABASE!=='itc_crm_test'||!['127.0.0.1','localhost'].includes(process.env.DB_HOST)) throw Error('Use isolated local itc_crm_test database');
process.env.OPENAI_API_KEY='isolated-no-network';process.env.JWT_SECRET='isolated-legal-publishing';
const db=require('../config/db');const app=require('../server');let server,base,adminId;const created=[];
after(async()=>{if(created.length)await db.query('DELETE FROM legal_documents WHERE id=ANY($1::bigint[])',[created]);if(adminId)await db.query('DELETE FROM admins WHERE id=$1',[adminId]);if(server)await new Promise(r=>server.close(r));await db.end();});
test('panel can create, save and publish legal documents using the actual PostgreSQL schema',async()=>{
 await db.query(fs.readFileSync('database/schema.sql','utf8'));
 await db.query(fs.readFileSync('database/security-hardening.sql','utf8'));
 adminId=(await db.query("INSERT INTO admins(email,name,password_hash,role) VALUES($1,'Legal QA','unused','admin') RETURNING id",[`legal-qa-${Date.now()}@example.test`])).rows[0].id;
 const token=jwt.sign({id:adminId,type:'staff'},process.env.JWT_SECRET);
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api`;
 async function request(path,method='GET',body,authenticated=true){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(authenticated?{Authorization:`Bearer ${token}`}:{})},body:body&&JSON.stringify(body)});return {status:response.status,body:await response.json()};}
 for(const slug of ['terms','privacy','subscription','accessibility']){
  const draft=await request('/legal/admin/documents','POST',{slug,language:'en',title:`QA ${slug}`,content:'Isolated approved example text.'});assert.equal(draft.status,201);created.push(draft.body.id);
  const saved=await request(`/legal/admin/documents/${draft.body.id}`,'PUT',{title:`QA ${slug} saved`,content:'Exact saved example text.'});assert.equal(saved.status,200);
  const published=await request(`/legal/admin/documents/${draft.body.id}/publish`,'POST');assert.equal(published.status,200);assert.ok(published.body.publishedAt);
  const current=await request(`/legal/${slug}?lang=en`,'GET',null,false);assert.equal(current.status,200);assert.equal(current.body.document.id,draft.body.id);assert.equal(current.body.document.content,'Exact saved example text.');
  const locked=await request(`/legal/admin/documents/${draft.body.id}`,'PUT',{content:'Must not alter accepted terms.'});assert.equal(locked.status,409);
  const next=await request('/legal/admin/documents','POST',{slug,language:'en',title:'Next version',content:'New draft, not published.'});assert.equal(next.status,201);created.push(next.body.id);assert.equal(next.body.version,draft.body.version+1);
  assert.equal((await request(`/legal/${slug}?lang=en`,'GET',null,false)).body.document.id,draft.body.id);
 }
 const incomplete=await request('/legal/admin/documents','POST',{slug:'terms',language:'es',title:'Incomplete QA',content:'[COMPLETAR: approved content]'});assert.equal(incomplete.status,201);created.push(incomplete.body.id);assert.equal((await request(`/legal/admin/documents/${incomplete.body.id}/publish`,'POST')).status,409);
 assert.equal((await request('/legal/admin/documents','POST',{slug:'terms',language:'en',title:'No access',content:'Text'},false)).status,401);
});
