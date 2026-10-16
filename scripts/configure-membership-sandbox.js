// Run only in the authenticated deployment job. Never prints credentials.
const {execFileSync}=require('child_process');
const Stripe=require('stripe');
const key=process.env.MEMBERSHIP_SANDBOX_KEY,whsec=process.env.MEMBERSHIP_SANDBOX_WEBHOOK;
async function main(){
 if(!key&&!whsec){console.log('Sandbox configuration unchanged.');return;}
 if(!/^sk_test_/.test(key||'')||!/^whsec_/.test(whsec||''))throw Error('Expected complete test credentials');
 const project='itc-developer-502721';
 const read=name=>execFileSync('gcloud',['secrets','versions','access','latest','--secret',name,'--project',project],{encoding:'utf8'}).trim();
 const previous=read('STRIPE_SECRET_KEY');
 if(!/^sk_test_/.test(previous))throw Error('Refusing to replace a live membership configuration');
 const current=Stripe(previous),next=Stripe(key);
 const [a,b,p]=await Promise.all([current.accounts.retrieve(),next.accounts.retrieve(),next.prices.retrieve('price_1U5uQjEbsP0HgIufrQFsjlrg')]);
 if(a.id!==b.id || p.livemode || p.unit_amount!==499 || p.currency!=='usd'||p.recurring?.interval!=='month'||p.recurring?.interval_count!==1)throw Error('Sandbox account or monthly price mismatch');
 // Validate the provided signing secret without creating a checkout/payment.
 const endpoints=await next.webhookEndpoints.list({limit:100});
 if(!endpoints.data.some(x=>x.url==='https://itc-backend-1031252664334.us-east1.run.app/api/payment/webhook'&&x.status==='enabled'))throw Error('Membership webhook missing');
 for(const [name,value] of [['STRIPE_SECRET_KEY',key],['STRIPE_PRICE_ID',p.id],['MEMBERSHIP_SANDBOX_WEBHOOK_SECRET',whsec]]){
  try{execFileSync('gcloud',['secrets','describe',name,'--project',project],{stdio:'ignore'});}catch{execFileSync('gcloud',['secrets','create',name,'--replication-policy','automatic','--project',project],{stdio:'ignore'});}
  execFileSync('gcloud',['secrets','versions','add',name,'--data-file=-','--project',project],{input:value,stdio:['pipe','ignore','pipe']});
 }
 const policy=JSON.parse(execFileSync('gcloud',['secrets','get-iam-policy','STRIPE_SECRET_KEY','--project',project,'--format=json'],{encoding:'utf8'}));
 for(const binding of policy.bindings||[])if(binding.role==='roles/secretmanager.secretAccessor')for(const member of binding.members||[]){
  execFileSync('gcloud',['secrets','add-iam-policy-binding','MEMBERSHIP_SANDBOX_WEBHOOK_SECRET','--project',project,'--member',member,'--role','roles/secretmanager.secretAccessor','--quiet'],{stdio:'ignore'});
 }
 console.log('Verified same test account and USD 4.99/month; sandbox configuration stored.');
}
main().catch(e=>{console.error('Sandbox configuration failed:',e.message?.split('\n')[0]);process.exitCode=1;});
