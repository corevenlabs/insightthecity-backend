// Explicit reviewed mapping only: never infer relationships by name.
const db=require('../config/db');
const P=require('../services/partner-publication.service');
const assert=require('node:assert/strict');
const mapping=require('../config/partner-publication-links.json');
const protectedFields=['owner_id','form_status','activated_at','expires_at','link_version','link_expires_at','payment_status','amount_cents','offer'];
(async()=>{
 const apply=process.argv.includes('--apply'),c=await db.connect(),results=[];
 try{
  await c.query(apply?'BEGIN':'BEGIN READ ONLY');
  if(process.argv.includes('--audit')) {
   assert(!apply,'Audit cannot apply changes');
   const clients=(await c.query(`SELECT p.id,p.business_name,p.form_status,p.experience_id,e.title,e.is_published FROM partner_clients p LEFT JOIN experiences e ON e.id=p.experience_id WHERE p.deleted_at IS NULL ORDER BY p.business_name`)).rows;
   const drafts=(await c.query(`SELECT id,client_id,experience_id,status,payload->>'title' AS title FROM experience_drafts ORDER BY updated_at DESC`)).rows;
   const experiences=(await c.query('SELECT id,title,is_published FROM experiences ORDER BY title')).rows;
   await c.query('COMMIT');console.log(JSON.stringify({apply:false,clients,drafts,experiences},null,2));return;
  }
  for(const target of mapping){
   const client=(await c.query('SELECT * FROM partner_clients WHERE id=$1'+(apply?' FOR UPDATE':''),[target.client_id])).rows[0];
   assert(client && !client.deleted_at && !client.blocked_at,'Client unavailable: '+target.business_name);
   assert.equal(client.business_name,target.business_name,'Client name changed');
   assert(!client.experience_id || client.experience_id===target.experience_id,'Client already linked elsewhere');
   const e=(await c.query('SELECT id,title,is_published FROM experiences WHERE id=$1',[target.experience_id])).rows[0];
   assert(e,'Missing experience: '+target.experience_id);assert.equal(e.title,target.experience_title,'Experience title changed');
   const before=Object.fromEntries(protectedFields.map(k=>[k,client[k]]));
   if(apply){
    await P.link(c,client,e.id,{role:'admin',id:null});
    const after=(await c.query('SELECT * FROM partner_clients WHERE id=$1',[client.id])).rows[0];
    assert.deepEqual(Object.fromEntries(protectedFields.map(k=>[k,after[k]])),before,'Commercial fields changed');
   }
   results.push({business:client.business_name,experience:e.title,published:e.is_published,alreadyLinked:client.experience_id===e.id,commercialFieldsPreserved:true});
  }
  const states=(await c.query(`SELECT p.business_name,p.form_status,p.experience_id,p.activated_at,p.expires_at,e.title AS experience_title,e.is_published FROM partner_clients p LEFT JOIN experiences e ON e.id=p.experience_id WHERE p.deleted_at IS NULL ORDER BY p.business_name`)).rows;
  await c.query('COMMIT');console.log(JSON.stringify({apply,results,states},null,2));
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
