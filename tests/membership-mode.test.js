const {test}=require('node:test'),assert=require('node:assert/strict');
const mode=require('../services/membership-mode.service');
test('live campaign requires explicit mode, matching keys and separate activation',()=>{
 const saved={...process.env};
 try{
  process.env.MEMBERSHIP_LAUNCH_TEST_ENABLED='true';process.env.STRIPE_SECRET_KEY='sk_live_example';delete process.env.MEMBERSHIP_CAMPAIGN_MODE;delete process.env.MEMBERSHIP_LAUNCH_LIVE_ENABLED;
  assert.equal(mode.enabled(),false);
  process.env.MEMBERSHIP_LIVE_SECRET_KEY='sk_live_example';process.env.MEMBERSHIP_CAMPAIGN_MODE='live';assert.equal(mode.enabled(),false);
  process.env.MEMBERSHIP_LAUNCH_LIVE_ENABLED='true';assert.equal(mode.enabled(),true);
  assert.equal(mode.matches({livemode:true}),true);assert.equal(mode.matches({livemode:false}),false);
  process.env.MEMBERSHIP_LIVE_SECRET_KEY='sk_test_example';assert.equal(mode.enabled(),false);
  process.env.MEMBERSHIP_CAMPAIGN_MODE='unknown';assert.equal(mode.enabled(),false);
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
test('live page never describes real card collection as sandbox',()=>{
 const previous=process.env.MEMBERSHIP_CAMPAIGN_MODE;
 try{process.env.MEMBERSHIP_CAMPAIGN_MODE='live';const html=require('../services/membership-launch-page').page();assert.doesNotMatch(html,/PRUEBA EN SANDBOX/);assert.match(html,/US\$4.99 al mes/);assert.match(html,/30 días gratis/);}
 finally{if(previous===undefined)delete process.env.MEMBERSHIP_CAMPAIGN_MODE;else process.env.MEMBERSHIP_CAMPAIGN_MODE=previous;}
});
