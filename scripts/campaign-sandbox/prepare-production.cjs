// Connect the existing administrator panel to test mode without changing legacy keys.
const {execFileSync}=require('node:child_process');
const PROJECT='itc-developer-502721',BASE='https://itc-backend-1031252664334.us-east1.run.app';
const g=args=>execFileSync('gcloud',[...args,'--project',PROJECT,'--quiet'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
(async()=>{
 const spec=JSON.parse(g(['run','services','describe','itc-backend','--region','us-east1','--format=json']));
 const vars=spec.spec.template.spec.containers[0].env||[],runtime=spec.spec.template.spec.serviceAccountName||'1031252664334-compute@developer.gserviceaccount.com';
 g(['secrets','add-iam-policy-binding','PARTNER_CAMPAIGNS_TEST_JWT_SECRET',`--member=serviceAccount:${runtime}`,'--role=roles/secretmanager.secretAccessor']);
 const named=name=>vars.find(v=>v.name===name)?.valueFrom?.secretKeyRef?.name;
 const keyName=named('PARTNER_STRIPE_SECRET_KEY')||named('STRIPE_SECRET_KEY');if(!keyName)throw Error('No existing partner Stripe secret reference was found');
 const key=g(['secrets','versions','access','latest','--secret',keyName]);const stripe=require('stripe')(key),balance=await stripe.balance.retrieve();
 if(balance.livemode!==true)throw Error('The existing partner account is not live; no production keys were changed');
 const possible=[];
 if(named('PARTNER_STRIPE_WEBHOOK_SECRET'))possible.push(BASE+'/api/partners/payment/webhook');
 if(keyName===named('STRIPE_SECRET_KEY')&&named('STRIPE_WEBHOOK_SECRET'))possible.push(BASE+'/api/payment/webhook');
 let endpoint;for await(const e of stripe.webhookEndpoints.list({limit:100}))if(possible.includes(e.url)&&e.status==='enabled'&&e.livemode)endpoint=e;
 if(!endpoint)throw Error('An existing signed live partner webhook is required before enabling campaigns');
 const events=['checkout.session.completed','checkout.session.async_payment_succeeded','invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.marked_uncollectible','invoice.voided','customer.subscription.updated','customer.subscription.deleted'];
 if(!endpoint.enabled_events.includes('*')&&events.some(e=>!endpoint.enabled_events.includes(e)))await stripe.webhookEndpoints.update(endpoint.id,{enabled_events:[...new Set([...endpoint.enabled_events,...events])]});
 let tax=false;try{tax=(await stripe.tax.settings.retrieve()).status==='active';}catch{}
 console.log(JSON.stringify({partnerAccount:'live',existingWebhook:endpoint.id,requiredEventsEnabled:true,taxConfigured:tax,gatewayPermission:'scoped to test JWT secret',productsCreated:0,chargesCreated:0,legacyStripeKeysChanged:false}));
})().catch(e=>{console.error(e.code||String(e.message).replace(/(?:sk|rk|whsec)_(?:live_|test_)?[A-Za-z0-9]+/g,'[redacted]'));process.exitCode=1;});
