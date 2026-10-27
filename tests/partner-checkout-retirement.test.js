const {test}=require('node:test'),assert=require('node:assert/strict');
const {retire}=require('../scripts/retire-legacy-partner-checkouts.cjs');
const L=require('../services/partner-payment-link.service');
test('legacy retirement leaves completed, processing and unrelated payments untouched',async()=>{
 let expired=[];const urls=Object.values(L.LIVE_URLS).map(u=>u.split('?')[0]);
 const sessions=[{id:'open',status:'open',payment_status:'unpaid',amount_total:180000},{id:'processing',status:'open',payment_status:'unpaid',payment_intent:'pi_processing'},{id:'race_paid',status:'complete',payment_status:'paid'}];
 const stripe={paymentLinks:{list:()=> (async function*(){for(const [i,url]of urls.entries())yield{id:'plink_'+i,url,active:false,livemode:true};yield{id:'unrelated',url:'https://example.com/unrelated',livemode:true};})()},
 checkout:{sessions:{list:p=>(async function*(){assert.notEqual(p.payment_link,'unrelated');if(p.payment_link==='plink_0')yield*sessions;})(),retrieve:async id=>sessions.find(x=>x.id===id),expire:async id=>{expired.push(id);}}},paymentIntents:{retrieve:async()=>({status:'processing',amount_received:0})}};
 const preview=await retire(stripe,false);assert.equal(expired.length,0);assert.equal(preview.eligible.length,1);
 const result=await retire(stripe,true);assert.deepEqual(expired,['open']);assert.equal(result.skipped.length,2);
});
