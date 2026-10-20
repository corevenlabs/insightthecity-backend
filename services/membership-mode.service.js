// Campaign credentials are independent of normal membership billing.
function live(){return process.env.MEMBERSHIP_CAMPAIGN_MODE==='live';}
function secretKey(){return (live()?process.env.MEMBERSHIP_LIVE_SECRET_KEY:process.env.STRIPE_SECRET_KEY)||'';}
function publishableKey(){return (live()?process.env.MEMBERSHIP_LIVE_PUBLISHABLE_KEY:process.env.STRIPE_PUBLISHABLE_KEY)||'';}
function priceId(){return live()?process.env.MEMBERSHIP_LIVE_PRICE_ID:process.env.STRIPE_PRICE_ID;}
function webhookSecret(){return live()?process.env.MEMBERSHIP_LIVE_WEBHOOK_SECRET:process.env.STRIPE_WEBHOOK_SECRET;}
function configured(){
 const mode=process.env.MEMBERSHIP_CAMPAIGN_MODE||'test';
 return ['test','live'].includes(mode) && new RegExp(`^sk_${mode}_`).test(secretKey());
}
function enabled(){return configured() && (live()?process.env.MEMBERSHIP_LAUNCH_LIVE_ENABLED==='true':process.env.MEMBERSHIP_LAUNCH_TEST_ENABLED==='true');}
function matches(object){return configured() && object?.livemode===live();}
async function requirePublishedLegal(){
 if(!live())return;
 const legal=require('./legal.service');
 for(const slug of [...legal.REGISTER_SLUGS,...legal.SUBSCRIPTION_SLUGS]){
  if(!await legal.getCurrent(slug,'es'))throw Object.assign(Error('La activación requiere los documentos legales publicados.'),{status:503});
 }
}
module.exports={secretKey,publishableKey,priceId,webhookSecret,live,configured,enabled,matches,requirePublishedLegal};
