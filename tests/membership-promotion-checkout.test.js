const {test}=require('node:test');
const assert=require('node:assert/strict');
const db=require('../config/db'),mailer=require('../services/mailer.service');
const subscriptions=require('../services/subscription.service');

test('a completed zero-total coupon checkout activates premium without requiring a trial or paid invoice',async()=>{
 const originals={query:db.query,configured:mailer.isConfigured};
 let written;
 try {
  mailer.isConfigured=()=>false;
  db.query=async(sql,params)=>{assert.match(sql,/UPDATE users SET/);written=params;return {rows:[{id:17,is_premium:true,stripe_subscription_id:'sub_coupon',subscription_status:'active'}]};};
  const session={id:'cs_coupon',mode:'subscription',status:'complete',payment_status:'no_payment_required',amount_total:0,client_reference_id:'17',metadata:{purchase_type:'subscription',user_id:'17'},subscription:{id:'sub_coupon',customer:'cus_coupon',status:'active',metadata:{user_id:'17'},items:{data:[{current_period_end:1800000000,price:{unit_amount:499,currency:'usd',recurring:{interval:'month'}}}]}}};
  const billing={retrieveCheckoutSession:async id=>{assert.equal(id,'cs_coupon');return session;}};
  const user=await subscriptions.confirmCheckout(17,'cs_coupon',billing);
  assert.equal(user.is_premium,true);assert.equal(written[9],true);assert.equal(written[6],499);assert.equal(written[10],'normal');
  // A free total does not bypass the existing account ownership checks.
  assert.equal(await subscriptions.confirmCheckout(18,'cs_coupon',billing),null);
  session.status='open';assert.equal(await subscriptions.confirmCheckout(17,'cs_coupon',billing),null);
 } finally {db.query=originals.query;mailer.isConfigured=originals.configured;}
});
