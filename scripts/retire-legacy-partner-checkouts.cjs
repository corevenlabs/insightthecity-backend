// Close only unpaid, non-processing checkouts from the two superseded partner links.
const Stripe=require('stripe');
const L=require('../services/partner-payment-link.service');
async function retire(stripe,apply=false) {
  const urls=Object.values(L.LIVE_URLS).map(value=>{const u=new URL(value);return u.origin+u.pathname;});
  const links=[];
  for await(const l of stripe.paymentLinks.list({limit:100}))if(urls.includes(l.url))links.push(l);
  if(links.length!==2 || links.some(l=>!l.livemode))throw Error('Expected exactly two approved LIVE partner links');
  if(apply && links.some(l=>l.active))throw Error('Retire the old public links after deployment before closing their checkouts');
  const result={apply,closed:[],eligible:[],skipped:[]};
  for(const link of links)for await(const item of stripe.checkout.sessions.list({payment_link:link.id,status:'open',limit:100})) {
    const s=await stripe.checkout.sessions.retrieve(item.id);
    if(s.status!=='open' || s.payment_status!=='unpaid'){result.skipped.push({id:s.id,status:s.status,payment_status:s.payment_status});continue;}
    if(s.payment_intent) {
      const p=await stripe.paymentIntents.retrieve(typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent.id,{expand:['latest_charge']});
      if(!['canceled','requires_payment_method'].includes(p.status) || p.amount_received!==0 || p.latest_charge?.paid){result.skipped.push({id:s.id,payment_intent_status:p.status});continue;}
    }
    result.eligible.push({id:s.id,total:s.amount_total,discount:s.total_details?.amount_discount});
    if(!apply)continue;
    try {await stripe.checkout.sessions.expire(s.id);result.closed.push(s.id);}
    catch(error) {
      const current=await stripe.checkout.sessions.retrieve(s.id);
      if(current.status==='expired')result.closed.push(s.id);
      else if(current.status==='complete')result.skipped.push({id:s.id,status:current.status,payment_status:current.payment_status});
      else throw error;
    }
  }
  return result;
}
if(require.main===module) {
  const key=process.env.PARTNER_STRIPE_SECRET_KEY;
  if(!/^(sk|rk)_live_/.test(key||''))throw Error('Dedicated LIVE partner key required');
  retire(new Stripe(key),process.argv.includes('--apply')).then(result=>console.log(JSON.stringify(result,null,2))).catch(e=>{console.error(e.code||e.type||e.message);process.exitCode=1;});
}
module.exports={retire};
