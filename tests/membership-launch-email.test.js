const {test}=require('node:test'),assert=require('node:assert/strict');
const render=require('../services/membership-launch-email.service').render;
const common=require('../services/membership-email.service');
const {storeUrl,download}=require('../controllers/membership-download.controller');
const args={user:{name:'<Rafa>'},token:'a'.repeat(64),date:'17 de noviembre de 2026',price:'US$4.99',base:'https://example.test',escape:common.escape};
test('approved account email escapes names, retains private resumption link, and never says trial is already active',()=>{
 const m=render({...args,kind:'account'});assert.match(m.html,/&lt;Rafa&gt;/);assert.match(m.html,/membership-invitation#aaaa/);assert.match(m.html,/membership-account-created-es-v2.png/);assert.doesNotMatch(m.html,/<h1|Tu mes gratis de ITC Club ya está activo/);assert.match(m.text,/Sin cargo hoy/);assert.match(m.html,/font-family:Arial,Helvetica,sans-serif/);
});
test('approved active email uses actual Stripe date/price, official badge assets, and no duplicated heading',()=>{
 const m=render({...args,kind:'trial',price:'US$7.25'});assert.match(m.html,/membership-trial-active-es-v2.png/);assert.match(m.text,/US\$7.25 el 17 de noviembre/);assert.match(m.html,/app-store-es-v1.png/);assert.match(m.html,/google-play-es-v1.png/);assert.doesNotMatch(m.html,/<h1|membership-invitation#/);assert.match(m.html,/app\/download\?platform=ios/);
 const canceled=render({...args,kind:'trial',user:{...args.user,subscription_cancel_at_period_end:true}});assert.match(canceled.text,/no se realizará el primer cobro/);assert.doesNotMatch(canceled.text,/El primer cobro será/);
});
test('missing or unsafe download destinations show availability instead of fake store links',()=>{
 const original=process.env.APP_STORE_DOWNLOAD_URL;
 try{delete process.env.APP_STORE_DOWNLOAD_URL;assert.equal(storeUrl('ios'),null);process.env.APP_STORE_DOWNLOAD_URL='https://evil.example/app';assert.equal(storeUrl('ios'),null);process.env.APP_STORE_DOWNLOAD_URL='https://testflight.apple.com/j/example';assert.equal(storeUrl('ios'),process.env.APP_STORE_DOWNLOAD_URL);delete process.env.APP_STORE_DOWNLOAD_URL;
 let body;download({query:{platform:'ios'}},{set(){},type(){return this;},send(v){body=v;}});assert.match(body,/descarga todavía no disponible/);assert.doesNotMatch(body,/href="undefined"|href="https:\/\/evil/);
 }finally{if(original===undefined)delete process.env.APP_STORE_DOWNLOAD_URL;else process.env.APP_STORE_DOWNLOAD_URL=original;}
});
test('return page confirms only completed launch sessions and never claims an unpaid checkout is active',async()=>{
 const stripe=require('../services/membership-campaign-stripe.service'),subs=require('../services/subscription.service'),controller=require('../controllers/membership-download.controller');
 const oldRetrieve=stripe.retrieveCheckoutSession,oldConfirm=subs.confirmCheckout;let body,confirmed=0;
 const res={set(){},type(){return this;},status(){return this;},send(v){body=v;}};
 try{
 stripe.retrieveCheckoutSession=async()=>({mode:'subscription',status:'open'});subs.confirmCheckout=async()=>{confirmed++;return {is_premium:true,subscription_status:'trialing'};};
 await controller.activation({query:{session_id:'cs_test_example123'}},res,e=>{throw e;});assert.equal(confirmed,0);assert.match(body,/Estamos confirmando tu activación/);
 stripe.retrieveCheckoutSession=async()=>({mode:'subscription',status:'complete',client_reference_id:'99',subscription:{metadata:{launch_invitation_id:'invitation'}}});
 await controller.activation({query:{session_id:'cs_test_example123'}},res,e=>{throw e;});assert.equal(confirmed,1);assert.match(body,/<h1>Tu mes gratis está activo/);
 }finally{stripe.retrieveCheckoutSession=oldRetrieve;subs.confirmCheckout=oldConfirm;}
});
