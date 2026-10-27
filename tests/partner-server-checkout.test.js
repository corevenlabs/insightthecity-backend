const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../services/partner-server-checkout');
const L=require('../services/partner-payment-link.service');
test('server checkout fixes discounts, locks payer email and refuses incorrect totals before returning a URL',async()=>{
 const prior={...process.env};process.env.JWT_SECRET='server-checkout-test';process.env.FOUNDING_PARTNER_PAYMENT_LINK_ID='plink_fixed';
 const row={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',link_version:'v1',offer:'founding',amount_cents:30000,email:'owner@example.com',business_name:'Test business'};
 let bad=false,valid=true,created=0,expired=0,params,customerCalls=0;
 const stripe={paymentLinks:{retrieve:async()=>({id:'plink_fixed',url:new URL(L.URL).origin+new URL(L.URL).pathname,active:false,livemode:true,automatic_tax:{enabled:true}}),listLineItems:async()=>({data:[{quantity:1,price:{id:'price_fixed',unit_amount:120000,currency:'usd',tax_behavior:'exclusive',product:'prod_fixed'}}],has_more:false})},
 promotionCodes:{list:async()=>({data:[{active:true,promotion:{coupon:'coupon_fixed'},restrictions:{}}]})},coupons:{retrieve:async()=>({id:'coupon_fixed',valid,percent_off:75})},
 customers:{create:async p=>{customerCalls++;assert.equal(p.email,row.email);return{id:'cus_fixed',email:p.email};}},
 checkout:{sessions:{create:async(p,key)=>{created++;params=p;assert.match(key.idempotencyKey,/itc-partner-checkout:/);return{id:'cs_fixed',customer:'cus_fixed',mode:'payment',status:'open',payment_status:'unpaid',livemode:true,currency:'usd',url:'https://checkout.stripe.com/c/pay/cs_fixed',client_reference_id:p.client_reference_id,metadata:p.metadata,automatic_tax:p.automatic_tax,allow_promotion_codes:null,amount_subtotal:120000,amount_total:bad?120000:30000,total_details:{amount_discount:bad?0:90000,amount_tax:0,amount_shipping:0}};},expire:async id=>{assert.equal(id,'cs_fixed');expired++;}}}};
 try{
  const result=await S.create(stripe,row,'https://panel.example/partner#private-token');
  assert.equal(result.session.amount_total,30000);assert.equal(result.customerId,'cus_fixed');assert.equal(result.attempt,1);
  assert.deepEqual(params.discounts,[{coupon:'coupon_fixed'}]);assert.equal(params.customer,'cus_fixed');assert.equal(params.allow_promotion_codes,undefined);
  assert.match(params.cancel_url,/checkout=retry#private-token/);assert.match(params.success_url,/\{CHECKOUT_SESSION_ID\}/);
  bad=true;await assert.rejects(S.create(stripe,row,'https://panel.example/partner#token'),e=>e.status===409);assert.equal(expired,1);
  valid=false;const before=created;await assert.rejects(S.create(stripe,row,'https://panel.example/partner#token'),e=>e.status===409);assert.equal(created,before);assert.equal(customerCalls,2);
  assert.equal(S.validateOpen({...result.session,allow_promotion_codes:true},row),false);
  assert.equal(S.validateOpen({...result.session,client_reference_id:'other'},row),false);
  assert.equal(S.validateOpen({...result.session,metadata:{...result.session.metadata,partner_id:'other'}},row),false);
 }finally{for(const k of Object.keys(process.env))if(!(k in prior))delete process.env[k];Object.assign(process.env,prior);}
});
