const {test,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
if(process.env.DB_DATABASE!=='itc_crm_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated DB only');
const db=require('../config/db'),legal=require('../services/legal.service');
after(()=>db.end());
test('acceptance snapshot survives deletion without retaining name/email and exports PDF',async()=>{
 for(const file of ['schema.sql','security-hardening.sql','legal-evidence.sql'])await db.query(fs.readFileSync(`database/${file}`,'utf8'));
 const user=(await db.query("INSERT INTO users(name,email) VALUES('Private name',$1) RETURNING id",[`legal-${Date.now()}@example.test`])).rows[0];
 const doc=(await db.query("INSERT INTO legal_documents(slug,language,version,title,content,published_at) VALUES('subscription','en',99999,'Exact terms','Accepted text',NOW()) RETURNING id")).rows[0];
 let acceptance;
 try{
 await legal.recordAcceptance(null,{userId:user.id,language:'en',context:'subscription',slugs:['subscription'],customerReference:'cus_example',renewal:{amountCents:499,currency:'usd',interval:'month',affirmativeConsent:true}});
 acceptance=(await db.query('SELECT * FROM legal_acceptances WHERE user_id=$1',[user.id])).rows[0];
 await db.query('DELETE FROM users WHERE id=$1',[user.id]);
 const saved=await legal.acceptance(acceptance.id);
 assert.equal(saved.user_id,null);assert.ok(saved.account_deleted_at);assert.equal(saved.document_snapshot.content,'Accepted text');assert.equal(saved.renewal_snapshot.amountCents,499);
 const result=await legal.listAcceptances({search:`ITC-U-${user.id}`});assert.equal(result.items.length,1);assert.equal(result.items[0].userEmail,null);assert.equal(result.items[0].userName,null);
 const pdf=await require('../services/legal-evidence-pdf').render(saved);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
 await db.query(fs.readFileSync('database/legal-evidence.sql','utf8'));assert.equal((await legal.acceptance(acceptance.id)).document_snapshot.content,'Accepted text');
 }finally{if(acceptance)await db.query('DELETE FROM legal_acceptances WHERE id=$1',[acceptance.id]);await db.query('DELETE FROM users WHERE id=$1',[user.id]);await db.query('DELETE FROM legal_documents WHERE id=$1',[doc.id]);}
});
