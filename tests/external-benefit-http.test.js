const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../config/db');
const {show}=require('../controllers/external-benefit-link.controller');
test('browser gate never redirects early/late/unpublished and preserves the configured coupon while active',async()=>{
 const original=db.query;const now=Date.now();
 let row={id:'example',title:'Example',access:'premium',is_published:true,benefit_action:'external',benefit_url:'https://partner.example/pay?coupon=SAVE100&x=1',is_paid_event:true,ticket_url:'https://partner.example/tickets?code=TICKETS',external_benefit_starts_at:new Date(now+3600000),external_benefit_ends_at:new Date(now+7200000)};
 db.query=async(sql,args)=>{assert.match(sql,/^SELECT /);assert.deepEqual(args,['example']);return {rows:row?[row]:[]};};
 const app=express();app.get('/benefits/link/:id',show);app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const get=(q='')=>fetch(base+'/benefits/link/example'+q,{redirect:'manual'});
 try{
  let r=await get('?lang=es&now=99999999999999&url=https://evil.example');assert.equal(r.status,200);assert.match(await r.text(),/Próximamente/);assert.equal(r.headers.get('location'),null);assert.match(r.headers.get('cache-control'),/no-store/);
  r=await get('?lang=en&target=tickets');assert.equal(r.status,200);assert.match(await r.text(),/target=tickets/);
  row.external_benefit_starts_at=new Date(now-1000);
  r=await get('?url=https://evil.example');assert.equal(r.status,303);assert.equal(r.headers.get('location'),row.benefit_url);
  r=await get('?target=tickets');assert.equal(r.status,303);assert.equal(r.headers.get('location'),row.ticket_url);
  row.external_benefit_ends_at=new Date(now-1);
  r=await get('?lang=pt');assert.equal(r.status,410);assert.match(await r.text(),/Benefício encerrado/);assert.equal(r.headers.get('location'),null);
  row.external_benefit_starts_at=null;row.external_benefit_ends_at=null;
  r=await get();assert.equal(r.status,303);
  row.is_published=false;assert.equal((await get()).status,404);
  row.is_published=true;row.benefit_action='qr';assert.equal((await get()).status,404);
  row.benefit_action='external';row.benefit_url='javascript:alert(1)';assert.equal((await get()).status,503);
  row=null;assert.equal((await get()).status,404);
 }finally{db.query=original;await new Promise(r=>server.close(r));}
});
