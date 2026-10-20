// Read-only preflight for an authorized Cloud Shell session. Never prints credentials.
const {execFileSync}=require('child_process');
const Stripe=require('stripe');
const project='itc-developer-502721';
const read=name=>execFileSync('gcloud',['secrets','versions','access','latest','--secret',name,'--project',project],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function main(){
 const key=read('MEMBERSHIP_LIVE_SECRET_KEY'),pub=read('MEMBERSHIP_LIVE_PUBLISHABLE_KEY'),priceId=read('MEMBERSHIP_LIVE_PRICE_ID'),signature=read('MEMBERSHIP_LIVE_WEBHOOK_SECRET');
 if(!/^sk_live_[A-Za-z0-9]+$/.test(key)||!/^pk_live_[A-Za-z0-9]+$/.test(pub)||!/^whsec_[A-Za-z0-9]+$/.test(signature))throw Error('Live credential formats are invalid');
 if(priceId!=='price_1USQAsI4w6DUYfoWzFKl09ib')throw Error('Unexpected live price ID');
 const stripe=Stripe(key);
 const account=await stripe.accounts.retrieve();
 if(account.id!=='acct_1U5uGOI4w6DUYfoW')throw Error('The secret key belongs to a different Stripe account');
 const price=await stripe.prices.retrieve(priceId);
 if(!price.livemode||!price.active||price.unit_amount!==499||price.currency!=='usd'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1)throw Error('Expected active live USD 4.99 monthly price');
 const required=['invoice.payment_failed','invoice.payment_action_required','invoice.paid','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed','checkout.session.async_payment_succeeded'];
 let found=false;
 for await(const endpoint of stripe.webhookEndpoints.list({limit:100})){
  if(endpoint.url==='https://itc-backend-1031252664334.us-east1.run.app/api/payment/webhook' && endpoint.livemode && endpoint.status==='enabled' && required.every(e=>endpoint.enabled_events.includes(e)||endpoint.enabled_events.includes('*')))found=true;
 }
 if(!found)throw Error('Live membership webhook missing or incomplete');
 console.log('PASS: secret key account, active live USD 4.99/month price, live webhook events, and credential formats.');
 console.log('Pending: publishable-key account pairing and signing-secret pairing require end-to-end verification. No charges, subscriptions, invitations, or emails created.');
}
main().catch(()=>{console.error('Live verification failed. Check secret access, account, price and webhook configuration. Credential values omitted.');process.exitCode=1;});
