const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.OPENAI_API_KEY='test-only-no-network';process.env.JWT_SECRET='retired-download-test';
const id=require.resolve('../config/db');let queries=0;require.cache[id]={id,filename:id,loaded:true,exports:{query:async()=>{queries++;throw Error('Retired content must never query storage');}}};
const app=require('../server');
test('Older apps see an empty catalog, while all former management, purchase and download routes are closed',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const path of ['/api/guides','/api/guides/mine','/api/guides/admin']){const response=await fetch(base+path);assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);}
  for(const [method,path] of [['POST','/api/guides'],['POST','/api/guides/upload-pdf'],['PUT','/api/guides/1'],['DELETE','/api/guides/1'],['POST','/api/guides/1/purchase-session'],['POST','/api/guides/1/download'],['GET','/api/guides/1/file?ticket=old']]){const response=await fetch(base+path,{method});assert.equal(response.status,410);}
  assert.equal((await fetch(base+'/uploads/guides/private.pdf')).status,404);assert.equal(queries,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Old one-time checkout links do not enter subscription confirmation',()=>{
 const controller=require('../controllers/payment.controller');const res={set(){},type(){return this;},send(value){this.body=value;},status(code){throw Error('Unexpected '+code);}};
 controller.returnToApp({query:{to:'itcclub://checkout-return',result:'success',session_id:'cs_old',guide_id:'1'}},res);
 assert.ok(res.body.includes('result=cancel'));assert.ok(!res.body.includes('cs_old'));
});
