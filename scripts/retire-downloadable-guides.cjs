// One-time retirement audit. Never creates payments, refunds or subscription changes.
require('dotenv').config();
const db=require('../config/db');
(async()=>{
 const exists=(await db.query("SELECT to_regclass('public.guides') AS catalog,to_regclass('public.guide_purchases') AS purchases")).rows[0];
 const summary={};
 if(exists.catalog)summary.catalog=(await db.query('SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE is_published)::int AS published FROM guides')).rows[0];
 if(exists.purchases)summary.purchases=(await db.query('SELECT COUNT(*)::int AS total FROM guide_purchases')).rows[0];
 const stripe=new (require('stripe'))(process.env.STRIPE_SECRET_KEY);let open=0,expired=0;
 for await(const session of stripe.checkout.sessions.list({status:'open',created:{gte:Math.floor(Date.now()/1000)-48*3600},limit:100})){
  if(session.metadata?.purchase_type!=='guide'||!session.metadata?.guide_id||session.mode!=='payment')continue;
  open++;
  if(process.env.EXPIRE_RETIRED_CHECKOUTS==='true'){
   const current=await stripe.checkout.sessions.retrieve(session.id);
   if(current.status==='open'&&current.mode==='payment'&&current.payment_status==='unpaid'&&current.metadata?.purchase_type==='guide'){
    await stripe.checkout.sessions.expire(current.id);expired++;
   }
  }
 }
 console.log(JSON.stringify({retiredCatalogAudit:true,...summary,openLegacyCheckouts:open,expiredLegacyCheckouts:expired}));
})().then(()=>db.end()).catch(async error=>{console.error(error.message);await db.end();process.exitCode=1;});
