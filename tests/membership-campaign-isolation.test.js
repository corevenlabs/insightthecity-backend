const {test}=require('node:test'),assert=require('node:assert/strict');
const normal=require('../services/stripe.service'),campaign=require('../services/membership-campaign-stripe.service');
test('normal checkout never acquires the invitation trial or campaign price',async()=>{
 const saved={...process.env};let normalArgs,campaignArgs;
 try{
  process.env.STRIPE_PRICE_ID='price_normal';process.env.MEMBERSHIP_CAMPAIGN_MODE='live';process.env.MEMBERSHIP_LIVE_PRICE_ID='price_campaign';
  normal.setClient({checkout:{sessions:{create:async args=>{normalArgs=args;return {id:'cs_normal',url:'https://example.test'};}}}});
  campaign.setClient({subscriptions:{create:async args=>{campaignArgs=args;return {id:'sub_campaign'};}}});
  await normal.createCheckoutSession({user:{id:1},customerId:'cus_normal',baseUrl:'https://example.test',appReturnUrl:'itcclub://login',renewalNotice:'Normal'});
  await campaign.createLaunchSubscription({customerId:'cus_campaign',userId:2,paymentMethod:'pm_verified',invitationId:'invite',key:'once'});
  assert.equal(normalArgs.line_items[0].price,'price_normal');assert.equal(normalArgs.subscription_data.trial_period_days,undefined);
  assert.equal(campaignArgs.items[0].price,'price_campaign');assert.equal(campaignArgs.trial_period_days,30);assert.equal(campaignArgs.collection_method,'charge_automatically');
  const billing=require('../services/membership-billing.service');
  assert.equal(billing.forUser({stripe_billing_source:'campaign'}),campaign);assert.equal(billing.forUser({stripe_billing_source:'normal'}),normal);assert.equal(billing.forUser({}),normal);
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);normal.setClient(null);campaign.setClient(null);}
});
test('live campaign webhook ignores normal subscriptions and accepts only verified events',async()=>{
 const original={normal:normal.constructWebhookEvent,campaign:campaign.constructWebhookEvent,apply:require('../services/subscription.service').applyFromWebhook,mode:process.env.MEMBERSHIP_CAMPAIGN_MODE};
 const subscriptions=require('../services/subscription.service');let event,calls=0,code=200;
 const handler=require('../routes/stripe.webhook').stack[0].route.stack[0].handle;
 const res={status(value){code=value;return this;},json(){},send(){}};
 try{
  process.env.MEMBERSHIP_CAMPAIGN_MODE='live';normal.constructWebhookEvent=()=>{throw Error('wrong signature');};campaign.constructWebhookEvent=()=>event;subscriptions.applyFromWebhook=async()=>{calls++;};
  event={type:'customer.subscription.updated',data:{object:{metadata:{user_id:'1'}}}};
  await handler({headers:{},body:Buffer.from('')},res);assert.equal(calls,0);
  event.data.object.metadata.launch_invitation_id='invitation';await handler({headers:{},body:Buffer.from('')},res);assert.equal(calls,1);
  campaign.constructWebhookEvent=()=>{throw Error('invalid signature');};await handler({headers:{},body:Buffer.from('')},res);assert.equal(code,400);assert.equal(calls,1);
 }finally{normal.constructWebhookEvent=original.normal;campaign.constructWebhookEvent=original.campaign;subscriptions.applyFromWebhook=original.apply;if(original.mode===undefined)delete process.env.MEMBERSHIP_CAMPAIGN_MODE;else process.env.MEMBERSHIP_CAMPAIGN_MODE=original.mode;}
});
