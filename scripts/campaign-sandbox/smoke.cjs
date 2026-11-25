// Exercises the actual test account without collecting a payment or sending email.
const BASE=require('../../services/partner-campaign-sandbox').ORIGIN;
let bearer;
async function api(path,body,partner){
 const response=await fetch(BASE+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(partner?{Authorization:'Partner '+partner}:bearer?{Authorization:'Bearer '+bearer}:{})},body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok)throw Error(`Sandbox smoke ${path}: HTTP ${response.status} ${data.message||''}`);return data;
}
(async()=>{
 const jwt=require('jsonwebtoken'),assertion=jwt.sign({purpose:'campaign-test-gateway',actorId:1,role:'admin'},process.env.JWT_SECRET,{algorithm:'HS256',issuer:'https://itc-backend-1031252664334.us-east1.run.app',audience:BASE,expiresIn:'60s'});const auth=await api('/api/partners/campaign-test-session',{assertion});bearer=auth.token;
 if(!bearer)throw Error('Sandbox administrator login failed');
 const status=await api('/api/partners/campaign-sandbox/status');if(!status.sandbox||status.stripe!=='test'||status.delivery!=='captured')throw Error('Unexpected sandbox environment');
 const all=await api('/api/partners/campaigns');let campaign=all.find(c=>c.draft_config.name==='[Técnica] Prueba de campañas');
 if(!campaign)campaign=await api('/api/partners/campaigns',{config:{name:'[Técnica] Prueba de campañas',description:'Campaña técnica del entorno de pruebas. No usar como acuerdo comercial.',currency:'usd',mode:'installments',normalPriceCents:20000,priceCents:14000,installments:4,publicationMonths:4,publicationStart:'publication',renewal:true,renewalPriceCents:20000,termsTitle:'Sandbox test agreement',termsContent:'This is a technical sandbox verification only. No real money is charged and this is not a commercial agreement. Four simulated monthly installments; publication begins after approval.',termsApproved:true}});
 if(campaign.status==='draft')campaign=await api(`/api/partners/campaigns/${campaign.id}/actions`,{action:'activate',confirm:true,expectedVersion:campaign.draft_version});
 const clients=await api('/api/partners/clients');let client=clients.find(p=>p.business_name==='[Técnica] Negocio de prueba');
 if(!client)client=await api('/api/partners/clients',{campaign_id:campaign.id,business_name:'[Técnica] Negocio de prueba',contact_name:'Administrador de pruebas',email:process.env.CAMPAIGN_TEST_ADMIN_EMAIL});
 client=await api(`/api/partners/clients/${client.id}/actions`,{action:'generate-link'});
 const token=client.link.split('#')[1];
 const checkout=await api('/api/partners/access/checkout',{accept:true,signerName:'Administrador de pruebas',language:'en'},token);
 if(!/^https:\/\/checkout.stripe.com\//.test(checkout.url||''))throw Error('Sandbox checkout was not verified');
 const stripe=require('stripe')(process.env.PARTNER_STRIPE_SECRET_KEY);
 const updated=await api(`/api/partners/clients/${client.id}`);const session=await stripe.checkout.sessions.retrieve(updated.stripe_session_id);
 if(session.livemode!==false||session.amount_subtotal!==20000||session.total_details?.amount_discount!==6000)throw Error('Sandbox discount verification failed');
 // Keep the invitation usable, but close this diagnostic checkout before a human test.
 if(session.status==='open')await stripe.checkout.sessions.expire(session.id);
 console.log(JSON.stringify({environment:'campaign-sandbox',login:'verified',product:'created in Stripe sandbox',normalPriceCents:20000,discountCents:6000,checkout:'verified then expired; no charge',emailDelivery:'captured only',humanPaymentTest:'pending'}));
})().catch(e=>{console.error(String(e.message).replace(/(?:sk|whsec|rk)_(?:test_|live_)?[A-Za-z0-9]+/g,'[redacted]'));process.exitCode=1;});
