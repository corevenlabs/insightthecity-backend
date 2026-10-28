// Production verification: one pinned READ ONLY transaction, no chat writes or AI calls.
const assert=require('node:assert/strict');
const db=require('../config/db');
(async()=>{
 const client=await db.connect();
 const original=db.query;
 try{
  await client.query('BEGIN READ ONLY');
  db.query=(...args)=>client.query(...args);
  const chat=require('../services/chat.service');
  const rules=require('../services/chat-catalog-rules');
  const user={language:'es',is_premium:false};
  const results=[];
  let history=[];
  for(const message of ['¿Dónde puedo comer en NY con beneficios?','¿Y en Manhattan?','Ahora quiero museos en NY']){
   history.push({role:'user',message,created_at:new Date().toISOString()});
   const r=await chat.respond({user,history});
   assert.deepEqual(r.places,[]);
   if(results.length===0){assert.ok(r.appItems.length>0);assert.ok(r.appItems.every(i=>rules.classify(i).includes('food')&&i.region==='NY'&&i.hasBenefit));assert.ok(r.appItems.every(i=>i.image?.startsWith('https://')&&i.preview&&Array.from(i.preview).length<=146));}
   if(message.includes('museos'))assert.ok(r.appItems.every(i=>rules.classify(i).includes('museums')));
   results.push({query:message,reply:r.reply,items:r.appItems.map(i=>({id:i.id,title:i.title,source:i.source,benefit:i.memberBenefit,image:i.image,preview:i.preview})),showMembership:r.showMembership});
   history.push({role:'assistant',message:r.reply,catalog_context:r.context,created_at:new Date().toISOString()});
  }
  const active=await chat.respond({user:{...user,is_premium:true},history:[{role:'user',message:'Comida en NY'}]});
  assert.equal(active.showMembership,false);
  console.log(JSON.stringify({readOnly:true,passed:true,results},null,2));
 }finally{db.query=original;await client.query('ROLLBACK');client.release();await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
