// Provision only named sandbox resources; never log credentials or copy production data.
const {execFileSync}=require('node:child_process'),crypto=require('node:crypto'),fs=require('node:fs');
const {Client}=require('pg');
const PROJECT='itc-developer-502721',DATABASE='itc_campaigns_test',ACCOUNT=`itc-campaigns-test@${PROJECT}.iam.gserviceaccount.com`;
const BASE='https://itc-campaigns-test-backend-1031252664334.us-east1.run.app';
function g(args,input){return execFileSync('gcloud',[...args,'--project',PROJECT,'--quiet'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}
function exists(args){try{g(args);return true;}catch(e){if(/NOT_FOUND|not found|does not exist/i.test(String(e.stderr)))return false;throw e;}}
function ensureSecret(name,value){
 if(!exists(['secrets','describe',name]))g(['secrets','create',name,'--replication-policy=automatic']);
 try{return g(['secrets','versions','access','latest','--secret',name]);}catch(e){if(!/NOT_FOUND|not found|no versions/i.test(String(e.stderr)))throw e;}
 g(['secrets','versions','add',name,'--data-file=-'],value);return value;
}
function runtimeSecret(name){g(['secrets','add-iam-policy-binding',name,`--member=serviceAccount:${ACCOUNT}`,'--role=roles/secretmanager.secretAccessor']);}
const secretNames={stripe:'PARTNER_CAMPAIGNS_STRIPE_TEST_SECRET_KEY',database:'PARTNER_CAMPAIGNS_TEST_DB_PASSWORD',jwt:'PARTNER_CAMPAIGNS_TEST_JWT_SECRET',webhook:'PARTNER_CAMPAIGNS_TEST_WEBHOOK_SECRET',admin:'PARTNER_CAMPAIGNS_TEST_ADMIN_PASSWORD'};
(async()=>{
 const key=g(['secrets','versions','access','latest','--secret',secretNames.stripe]);if(!/^sk_test_/.test(key))throw Error('Configured campaign secret is not a sandbox test key');
 const stripe=require('stripe')(key);if((await stripe.balance.retrieve()).livemode!==false)throw Error('Stripe sandbox isolation check failed');
 const dbPassword=ensureSecret(secretNames.database,crypto.randomBytes(32).toString('base64url'));
 const jwt=ensureSecret(secretNames.jwt,crypto.randomBytes(48).toString('base64url'));
 const adminPassword=ensureSecret(secretNames.admin,crypto.randomBytes(24).toString('base64url'));
 if(!exists(['iam','service-accounts','describe',ACCOUNT]))g(['iam','service-accounts','create','itc-campaigns-test','--display-name=ITC Campaign Sandbox Runtime']);
 g(['projects','add-iam-policy-binding',PROJECT,`--member=serviceAccount:${ACCOUNT}`,'--role=roles/cloudsql.client','--condition=None']);
 g(['iam','service-accounts','add-iam-policy-binding',ACCOUNT,`--member=serviceAccount:github-deployer@${PROJECT}.iam.gserviceaccount.com`,'--role=roles/iam.serviceAccountUser']);
 // Connect to the maintenance database solely to create a separate restricted login/database.
 const maintenance=new Client({host:'127.0.0.1',port:5432,user:'itc_app',password:g(['secrets','versions','access','latest','--secret','DB_PASSWORD']),database:'postgres'});
 await maintenance.connect();try{
  if(!(await maintenance.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[DATABASE])).rowCount)await maintenance.query(`CREATE ROLE ${DATABASE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${maintenance.escapeLiteral(dbPassword)}`);
  else{const role=(await maintenance.query('SELECT rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=$1',[DATABASE])).rows[0];if(role.rolsuper||role.rolcreaterole||role.rolcreatedb)throw Error('Sandbox database role has excessive privileges');}
  if(!(await maintenance.query('SELECT 1 FROM pg_database WHERE datname=$1',[DATABASE])).rowCount)await maintenance.query(`CREATE DATABASE ${DATABASE} OWNER ${DATABASE}`);
 }finally{await maintenance.end();}
 const bucket=`${PROJECT}-campaign-tests-media`;
 if(!exists(['storage','buckets','describe',`gs://${bucket}`]))g(['storage','buckets','create',`gs://${bucket}`,'--location=us-east1','--uniform-bucket-level-access']);
 g(['storage','buckets','add-iam-policy-binding',`gs://${bucket}`,`--member=serviceAccount:${ACCOUNT}`,'--role=roles/storage.objectUser']);
 g(['storage','buckets','add-iam-policy-binding',`gs://${bucket}`,'--member=allUsers','--role=roles/storage.objectViewer']);
 const events=['checkout.session.completed','checkout.session.async_payment_succeeded','invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.marked_uncollectible','invoice.voided','customer.subscription.updated','customer.subscription.deleted'];
 const url=BASE+'/api/partners/payment/webhook';
 let endpoint=null;for await(const item of stripe.webhookEndpoints.list({limit:100}))if(item.url===url&&item.metadata?.itc_campaign_sandbox==='v1')endpoint=item;
 let webhook;
 if(endpoint){webhook=g(['secrets','versions','access','latest','--secret',secretNames.webhook]);if(endpoint.livemode||endpoint.status!=='enabled')throw Error('Sandbox webhook is not enabled');}
 else{endpoint=await stripe.webhookEndpoints.create({url,enabled_events:events,metadata:{itc_campaign_sandbox:'v1'},description:'ITC partner campaign sandbox only'},{idempotencyKey:'itc-campaign-sandbox-webhook-v1'});if(endpoint.livemode!==false||!endpoint.secret)throw Error('Unexpected webhook mode');webhook=ensureSecret(secretNames.webhook,endpoint.secret);}
 for(const name of [secretNames.stripe,secretNames.database,secretNames.jwt,secretNames.webhook])runtimeSecret(name);
 let tax=false;try{tax=(await stripe.tax.settings.retrieve()).status==='active';}catch{}
 const variables={DB_HOST:'127.0.0.1',DB_PORT:'5432',DB_USER:DATABASE,DB_DATABASE:DATABASE,DB_PASSWORD:dbPassword,DB_SSL:'false',PARTNER_CAMPAIGNS_SANDBOX:'true',PARTNER_CAMPAIGNS_ENABLED:'true',PARTNER_STRIPE_SECRET_KEY:key,STRIPE_SECRET_KEY:key,PARTNER_STRIPE_WEBHOOK_SECRET:webhook,JWT_SECRET:jwt,PUBLIC_BASE_URL:BASE,PANEL_PUBLIC_URL:'https://itc-campaigns-test-panel-1031252664334.us-east1.run.app',OPENAI_API_KEY:'sandbox-disabled-not-used',CAMPAIGN_SANDBOX_TAX_ENABLED:String(tax),CAMPAIGN_TEST_ADMIN_EMAIL:process.env.CAMPAIGN_TEST_ADMIN_EMAIL||'soporte@insightthecity.com',CAMPAIGN_TEST_ADMIN_PASSWORD:adminPassword};
 if(!fs.existsSync(process.env.GITHUB_ENV||''))throw Error('Provisioning runs only in the dedicated GitHub workflow');
 for(const value of [key,dbPassword,jwt,webhook,adminPassword])console.log(`::add-mask::${value}`);
 fs.appendFileSync(process.env.GITHUB_ENV,Object.entries(variables).map(([k,v])=>`${k}=${v}\n`).join(''));
 console.log(JSON.stringify({environment:'campaign-sandbox',database:DATABASE,webhookId:endpoint.id,webhookUrl:url,taxEnabled:tax,adminEmail:variables.CAMPAIGN_TEST_ADMIN_EMAIL,secretsStored:true}));
})().catch(e=>{console.error('Sandbox provisioning failed:',e.code||e.message);if(e.stderr)console.error(String(e.stderr).replace(/(?:sk|whsec|rk)_(?:test_|live_)?[A-Za-z0-9]+/g,'[redacted]'));process.exitCode=1;});
