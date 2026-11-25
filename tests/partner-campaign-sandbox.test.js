const {test}=require('node:test'),assert=require('node:assert/strict');
const {validate,restrict,ORIGIN}=require('../services/partner-campaign-sandbox');
const env=()=>({PARTNER_CAMPAIGNS_SANDBOX:'true',DB_DATABASE:'itc_campaigns_test',DB_USER:'itc_campaigns_test',PARTNER_STRIPE_SECRET_KEY:'sk_test_example',STRIPE_SECRET_KEY:'sk_test_example',PUBLIC_BASE_URL:ORIGIN,PANEL_PUBLIC_URL:'https://itc-campaigns-test-panel-1031252664334.us-east1.run.app'});
test('sandbox refuses production database, live keys, production URLs and mail delivery credentials',()=>{
 validate({});validate(env());
 for(const patch of [{DB_DATABASE:'itc'},{DB_USER:'itc_app'},{PARTNER_STRIPE_SECRET_KEY:'sk_live_example'},{PUBLIC_BASE_URL:'https://itc-backend-1031252664334.us-east1.run.app'},{SMTP_HOST:'smtp.example.com'},{RESEND_API_KEY:'secret'}])assert.throws(()=>validate({...env(),...patch}));
});
test('sandbox exposes only partner testing routes and does not alter normal routing',()=>{
 const previous=process.env.PARTNER_CAMPAIGNS_SANDBOX;let status=200,next=0;
 const res={set(){return this;},status(n){status=n;return this;},json(){return this;}};
 try{process.env.PARTNER_CAMPAIGNS_SANDBOX='true';restrict({path:'/api/users/login'},res,()=>next++);assert.equal(status,404);assert.equal(next,0);restrict({path:'/api/partners/campaigns'},res,()=>next++);assert.equal(next,1);restrict({path:'/api/payment/launch/retry-emails'},res,()=>next++);assert.equal(next,2);delete process.env.PARTNER_CAMPAIGNS_SANDBOX;restrict({path:'/api/users/login'},res,()=>next++);assert.equal(next,3);}finally{if(previous===undefined)delete process.env.PARTNER_CAMPAIGNS_SANDBOX;else process.env.PARTNER_CAMPAIGNS_SANDBOX=previous;}
});
test('sandbox deployments are manual and target separate service names and Stripe secrets',()=>{
 const fs=require('node:fs');const workflow=fs.readFileSync('.github/workflows/campaign-sandbox.yml','utf8'),deploy=fs.readFileSync('scripts/campaign-sandbox/deploy.py','utf8');
 assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/\n  push:/);assert.match(workflow,/SERVICE: itc-campaigns-test-backend/);assert.match(deploy,/PARTNER_CAMPAIGNS_STRIPE_TEST_SECRET_KEY/);assert.doesNotMatch(deploy,/'STRIPE_SECRET_KEY:latest'/);assert.match(deploy,/DB_DATABASE.*itc_campaigns_test/);
});
