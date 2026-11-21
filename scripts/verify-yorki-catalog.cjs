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
  const ask=async(message,prior=[])=>chat.respond({user,history:[...prior,{role:'user',message,created_at:new Date().toISOString()}]});
  const saved=result=>({role:'assistant',message:result.reply,catalog_context:result.context,created_at:new Date().toISOString()});
  const question='Que restaurantes hay con beneficios en Nueva York?';
  const clean=await ask(question);
  assert.ok(clean.appItems.length>0);
  const contextRecovery=[];
  for(const previous of ['Sushi en NY con beneficios','Comida gratis en NY']){
   const prior=await ask(previous);
   const recovered=await ask(question,[saved(prior)]);
   assert.deepEqual(recovered.appItems.map(item=>item.id),clean.appItems.map(item=>item.id));
   assert.deepEqual(recovered.filters.keywords,[]);assert.equal(recovered.filters.free,false);assert.equal(recovered.filters.region,'NY');
   contextRecovery.push({previous,query:question,reply:recovered.reply,titles:recovered.appItems.map(item=>item.title)});
  }
  const sushi=await ask('Sushi en NY con beneficios');
  const continued=await ask('¿Y en Manhattan?',[saved(sushi)]);
  assert.deepEqual(continued.filters.keywords,['sushi']);assert.equal(continued.filters.benefits,true);assert.equal(continued.filters.area,'Manhattan');
  // Exercise the family rails directly in the same production READ ONLY transaction.
  // No chat history is saved and no translation/model call is needed for these checks.
  const familyCatalog=(await require('../services/experiences.service').list({publishedOnly:true})).rows.map(row=>chat.experienceItem(row,new Date()));
  const familyResults=[];
  for(const query of ['Quiero hacer cosas con niños','Things to do with kids','O que fazer com crianças?']){
   const {filters}=rules.filtersFor([{role:'user',message:query}],familyCatalog);
   const matches=rules.matching(familyCatalog,filters);
   assert.equal(filters.audience,'family');assert.deepEqual(filters.keywords,[]);
   assert.ok(matches.length>0,'Expected explicitly documented family publications');
   assert.ok(matches.every(item=>item.familyFriendly===true));
   familyResults.push({query,titles:matches.map(item=>item.title)});
  }
  assert.deepEqual(familyResults[0].titles,familyResults[1].titles);
  assert.deepEqual(familyResults[0].titles,familyResults[2].titles);
  console.log(JSON.stringify({readOnly:true,passed:true,results,contextRecovery,familyResults,continuationFilters:continued.filters},null,2));
 }finally{db.query=original;await client.query('ROLLBACK');client.release();await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
