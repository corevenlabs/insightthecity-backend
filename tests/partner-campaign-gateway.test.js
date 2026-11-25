const {test}=require('node:test'),assert=require('node:assert/strict'),jwt=require('jsonwebtoken');
const {createGateway,targetPath,TEST_BASE,LIVE_BASE}=require('../services/partner-campaign-test-gateway');
test('test gateway rejects other APIs, traversal, arbitrary hosts and worker calls',()=>{
 for(const p of ['/users','//evil.example/partners/access','/partners/campaigns/worker','/partners/access/%2e%2e/campaigns','/auth/login','/partners/campaign-test-session'])assert.throws(()=>targetPath(p));
 assert.equal(targetPath('/partners/clients?status=paid'),'/partners/clients?status=paid');
});
test('gateway exchanges only authorized administrators, keeps real tokens private and preserves test errors',async()=>{
 const express=require('express'),app=express(),calls=[];app.use(express.json());
 const fetcher=async(url,init)=>{calls.push({url,init});if(url.endsWith('/campaign-test-session')){const p=jwt.verify(JSON.parse(init.body).assertion,'test-gateway-secret',{issuer:LIVE_BASE,audience:TEST_BASE});assert.equal(p.purpose,'campaign-test-gateway');assert.equal(p.actorId,17);return Response.json({token:'delegated-test-token'});}if(url.endsWith('/partners/clients/fail'))return Response.json({message:'expired test session'},{status:401});return Response.json({mode:'test',body:init.body||null},{headers:{'Content-Range':'experiences 0-0/1'}});};
 app.use((req,res,next)=>{if(req.headers.authorization==='Bearer real-admin')req.admin={id:17,role:'admin',session_version:0};next();});app.use(createGateway({secret:()=> 'test-gateway-secret',fetcher}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/partners/clients')).status,403);assert.equal(calls.length,0);
  let r=await fetch(base+'/partners/clients',{headers:{Authorization:'Bearer real-admin'}});assert.equal(r.status,200);assert.equal(r.headers.get('Content-Range'),'experiences 0-0/1');assert.equal(calls[1].url,TEST_BASE+'/api/partners/clients');assert.equal(calls[1].init.headers.Authorization,'Bearer delegated-test-token');
  r=await fetch(base+'/partners/clients',{method:'POST',headers:{Authorization:'Bearer real-admin','Content-Type':'application/json'},body:JSON.stringify({business:'Test only'})});assert.equal(r.status,200);assert.equal(calls.filter(c=>c.url.endsWith('/campaign-test-session')).length,1);assert.equal(calls.at(-1).init.body,'{"business":"Test only"}');
  assert.equal((await fetch(base+'/partners/clients/fail',{headers:{Authorization:'Bearer real-admin'}})).status,502);
  const publicForm=await fetch(base+'/partners/access',{headers:{Authorization:'Partner private-test-token'}});assert.equal(publicForm.status,200);assert.equal(calls.at(-1).init.headers.Authorization,'Partner private-test-token');
  assert.equal((await fetch(base+'/partners/access')).status,401);assert.ok(!calls.some(c=>c.init.headers.Authorization==='Bearer real-admin'));
 }finally{await new Promise(r=>server.close(r));}
});
