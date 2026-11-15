// Creates only fixtures in an explicitly isolated local database. Never production.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
if(process.env.DB_HOST!=='127.0.0.1'||!/^itc_publication_text_test_[a-z0-9_]+$/.test(process.env.DB_DATABASE||''))throw Error('Isolated publication text test database only');
process.env.JWT_SECRET='publication-text-tests-only';
const db=require('../config/db');
const jwt=require('jsonwebtoken');
const express=require('express');
const app=express();app.use(express.json());
app.use('/experiences',require('../routes/experiences.routes'));
app.use('/partners',require('../routes/partner.routes'));
app.use('/drafts',require('../routes/experience-drafts.routes'));
app.use(require('../middleware/manejadorErrores'));
let server,base;
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.end();});
test('invalid pasted characters cannot block partner save and admin publication; all normal text remains',async()=>{
 // Reproduce the exact production error class on the local database, without writes.
 await assert.rejects(db.query('SELECT $1::text',['copied\u0000text']),e=>e.code==='22021');
 const roles={};for(const role of ['admin','executive'])roles[role]=(await db.query('INSERT INTO admins(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[role,role+'@example.test','test-only',role])).rows[0].id;
 const client=(await db.query("INSERT INTO partner_clients(business_name,contact_name,email,owner_id,category,offer,amount_cents,payment_method,payment_status,form_status) VALUES('Local musical','Owner','client@example.test',$1,'strategic','strategic',0,'waived','waived','submitted') RETURNING *",[roles.executive])).rows[0];
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 const api=async(path,role,method,body)=>{
  const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+jwt.sign({type:'staff',id:roles[role]},process.env.JWT_SECRET),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
 };
 const description='Música\u0000 cubana — São Paulo, acción, café 🎭 👨‍👩‍👧‍👦\nSegunda línea.';
 const body={title:'Musical\u0000 en Broadway 🎭',tags:['BROADWAY'],access:'premium',region:'NY',image:'https://example.test/cover.jpg',images:[1,2,3,4].map(n=>'https://example.test/'+n+'.jpg'),description,recommendation:'¡Disfruta\u0000 el espectáculo!',includes:['Entrada\u0000 general','Música 🎶'],memberBenefit:'Precio\u0000 especial',cardBenefit:'Entradas especiales',showBenefitOnCard:true,benefitAction:'external',benefitUrl:'https://example.test/tickets',isPublished:false,isPaidEvent:false,endsAt:'2026-12-17T23:59:00.000Z'};
 const saved=await api('/partners/clients/'+client.id+'/experience','executive','PUT',body);
 assert.equal(saved.status,201,JSON.stringify(saved.body));
 const id=saved.body.id;
 const stored=(await db.query('SELECT * FROM experiences WHERE id=$1',[id])).rows[0];
 assert.equal(stored.is_published,false);assert.equal(stored.description,description.replaceAll('\u0000',''));
 assert.equal(stored.recommendation,'¡Disfruta el espectáculo!');assert.equal(stored.member_benefit,'Precio especial');
 assert.equal(stored.ends_at.toISOString(),body.endsAt);assert.equal(stored.benefit_url,body.benefitUrl);
 assert.deepEqual((await db.query('SELECT item FROM experience_includes WHERE experience_id=$1 ORDER BY sort_order',[id])).rows.map(x=>x.item),['Entrada general','Música 🎶']);
 const before=(await db.query('SELECT * FROM partner_clients WHERE id=$1',[client.id])).rows[0];
 assert.equal(before.payment_status,'waived');assert.equal(before.activated_at,null);
 assert.equal((await api('/experiences/'+id,'executive','PUT',{...body,isPublished:true})).status,403);
 const published=await api('/experiences/'+id,'admin','PUT',{...body,isPublished:true});assert.equal(published.status,200,JSON.stringify(published.body));assert.equal(published.body.isPublished,true);
 const after=(await db.query('SELECT * FROM partner_clients WHERE id=$1',[client.id])).rows[0];assert.deepEqual(after,before);
 // An older panel bundle is supported. Draft JSON is also cleaned before persistence.
 const draft=await api('/drafts','executive','POST',{...body,title:'Borrador\u0000 independiente',client_id:null});
 assert.equal(draft.status,201,JSON.stringify(draft.body));assert.equal(draft.body.payload.title,'Borrador independiente');
 assert.equal(draft.body.payload.description,description.replaceAll('\u0000',''));
 const approved=await api('/drafts/'+draft.body.id+'/approve','admin','POST',{payload:{...body,title:'Publicación\u0000 directa'},client_id:null});
 assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(approved.body.status,'approved');
 const direct=(await db.query('SELECT title,is_published FROM experiences WHERE id=$1',[approved.body.experience_id])).rows[0];assert.equal(direct.title,'Publicación directa');assert.equal(direct.is_published,true);
 // Links and identifiers must never be silently rewritten.
 const bad=await api('/experiences/'+id,'admin','PUT',{...body,benefitUrl:'https://example.test/\u0000tickets'});
 assert.equal(bad.status,400);assert.match(bad.body.message,/enlace del beneficio/i);
 assert.equal((await db.query('SELECT benefit_url FROM experiences WHERE id=$1',[id])).rows[0].benefit_url,body.benefitUrl);
 const blank=await api('/experiences','admin','POST',{...body,title:'\u0000'});assert.equal(blank.status,400);
});
