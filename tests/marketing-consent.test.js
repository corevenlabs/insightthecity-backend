const {test}=require('node:test'),assert=require('node:assert/strict');
const service=require('../services/marketing-consent.service');
test('Promotions require a literal boolean opt-in; absent and false never update existing accounts',async()=>{
 const calls=[],client={query:async(...args)=>{calls.push(args);}};
 for(const accepted of [undefined,false])await service.recordRegistration(client,{userId:42,accepted,language:'en',source:'email-register'});
 assert.equal(calls.length,0);
 for(const accepted of ['true','false',1,null,{}])await assert.rejects(service.recordRegistration(client,{userId:42,accepted}),{status:400});
 for(const language of ['es','en','pt']){
  await service.recordRegistration(client,{userId:42,accepted:true,language,source:'google-register'});
  const [sql,values]=calls.at(-1);assert.match(sql,/marketing_consent_at = NOW\(\)/);assert.equal(values[0],42);assert.equal(values[2],language);assert.equal(values[3],service.COPY[language]);assert.equal(values[4],'google-register');
 }
});
