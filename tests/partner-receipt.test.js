const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../services/partner-receipt.service');
const {receiptData,session}=require('./fixtures/partner-receipt.cjs');
const client={offer:'founding',amount_cents:30000,email:'payer@example.test',business_name:'Different profile name'};
test('receipt uses Stripe payer and issuer, verified tax and immutable references without card secrets',async()=>{
 const r=R.snapshot(receiptData(session),client);
 assert.equal(r.issuer.name,'Eventland LLC');assert.equal(r.payer.businessName,'Montclair Cafe');assert.equal(r.businessName,'Different profile name');assert.equal(r.amounts.total,32000);assert.equal(r.amounts.tax,2000);assert.equal(r.paymentMethod,'card - visa - ending in 4242');
 assert.equal(R.snapshot(receiptData(session),client).reference,r.reference);
 assert(!JSON.stringify(r).includes('client_secret'));
 for(const change of [{amount_total:1},{customer_details:{email:'another@example.test'}},{payment_status:'unpaid'}])assert.throws(()=>R.snapshot(receiptData({...session,...change}),client));
 const invalid=receiptData(session);invalid.session.payment_intent.latest_charge.amount=30000;assert.throws(()=>R.snapshot(invalid,client));
 const bytes=await R.pdf(r);assert.equal(bytes.subarray(0,4).toString(),'%PDF');
});
test('Strategic PDF is a zero-cost confirmation and requires no PaymentIntent',async()=>{
 const s={...session,id:'cs_live_free_example',amount_total:0,amount_subtotal:180000,total_details:{amount_discount:180000,amount_tax:0,amount_shipping:0},payment_status:'no_payment_required',payment_intent:null};
 const r=R.snapshot(receiptData(s),{...client,offer:'strategic',amount_cents:0});assert.equal(r.kind,'participation');assert.equal(R.snapshot(receiptData({...s,payment_status:'paid'}),{...client,offer:'strategic',amount_cents:0}).kind,'participation');assert.equal(r.paymentIntentId,null);assert.equal(r.amounts.discount,180000);assert.equal(r.amounts.total,0);assert.match(R.filename(r),/Participation-Confirmation/);assert.equal((await R.pdf(r)).subarray(0,4).toString(),'%PDF');
});
test('queued welcome keeps its original design and attaches the same receipt on retries',async()=>{
 const mail=require('../services/partner-email.service');const receipt=R.snapshot(receiptData(session),client);let saved;
 const c={query:async(sql,args)=>{saved=JSON.parse(args[3]);}};
 const data={client:{...client,stripe_payment_receipt:receipt},owner:{name:'Executive',email:'exec@example.test'},url:'https://example.test/private',language:'en'};
 await mail.queue(c,{key:'paid:example',clientId:'example',to:client.email,kind:'invite',data});
 assert.match(saved.html,/partner-welcome-banner-v2.png/);assert.match(saved.html,/Create my business profile/);assert.match(saved.text,/Your payment receipt is attached/);assert.equal(saved.attachments.length,1);assert.equal(saved.attachments[0].filename,R.filename(receipt));assert.equal(Buffer.from(saved.attachments[0].content,'base64').subarray(0,4).toString(),'%PDF');
 const original=saved.attachments[0].filename;await mail.queue(c,{key:'resend:example',clientId:'example',to:client.email,kind:'invite',data});assert.equal(saved.attachments[0].filename,original);
});
