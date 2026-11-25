import json,os,subprocess,tempfile
PROJECT='itc-developer-502721'
SERVICE='itc-campaigns-test-backend'
BASE='https://'+SERVICE+'-1031252664334.us-east1.run.app'
ACCOUNT='itc-campaigns-test@'+PROJECT+'.iam.gserviceaccount.com'
if os.environ.get('DB_DATABASE')!='itc_campaigns_test':raise SystemExit('Isolated database required')
def g(args):return subprocess.run(['gcloud',*args,'--project',PROJECT,'--quiet'],check=True,capture_output=True,text=True).stdout
before=json.loads(g(['run','services','describe','itc-backend','--region','us-east1','--format=json']))['status'].get('traffic',[])
env={'NODE_ENV':'production','PARTNER_CAMPAIGNS_SANDBOX':'true','PARTNER_CAMPAIGNS_ENABLED':'true','DB_HOST':'/cloudsql/'+PROJECT+':us-east1:itc-postgres','DB_USER':'itc_campaigns_test','DB_DATABASE':'itc_campaigns_test','DB_SSL':'false','PUBLIC_BASE_URL':BASE,'PANEL_PUBLIC_URL':'https://itc-campaigns-test-panel-1031252664334.us-east1.run.app','UPLOAD_DRIVER':'gcs','GCS_PROJECT_ID':PROJECT,'GCS_BUCKET':PROJECT+'-campaign-tests-media','OPENAI_API_KEY':'sandbox-disabled-not-used','CAMPAIGN_SANDBOX_TAX_ENABLED':os.environ['CAMPAIGN_SANDBOX_TAX_ENABLED']}
secrets={'PARTNER_STRIPE_SECRET_KEY':'PARTNER_CAMPAIGNS_STRIPE_TEST_SECRET_KEY:latest','STRIPE_SECRET_KEY':'PARTNER_CAMPAIGNS_STRIPE_TEST_SECRET_KEY:latest','PARTNER_STRIPE_WEBHOOK_SECRET':'PARTNER_CAMPAIGNS_TEST_WEBHOOK_SECRET:latest','DB_PASSWORD':'PARTNER_CAMPAIGNS_TEST_DB_PASSWORD:latest','JWT_SECRET':'PARTNER_CAMPAIGNS_TEST_JWT_SECRET:latest'}
with tempfile.NamedTemporaryFile(mode='w',suffix='.yaml') as f:
 json.dump(env,f);f.flush()
 g(['run','deploy',SERVICE,'--region','us-east1','--image',f'us-east1-docker.pkg.dev/{PROJECT}/itc/{SERVICE}:'+os.environ['SOURCE_SHA'],'--service-account',ACCOUNT,'--allow-unauthenticated','--port','8080','--min-instances','0','--max-instances','2','--memory','512Mi','--cpu','1','--add-cloudsql-instances',PROJECT+':us-east1:itc-postgres','--env-vars-file',f.name,'--set-secrets',','.join(k+'='+v for k,v in secrets.items())])
job='itc-campaigns-test-worker'
try:g(['scheduler','jobs','describe',job,'--location','us-east1']);verb='update'
except subprocess.CalledProcessError as e:
 if 'NOT_FOUND' not in e.stderr:raise
 verb='create'
g(['scheduler','jobs',verb,'http',job,'--location','us-east1','--schedule','*/10 * * * *','--uri',BASE+'/api/payment/launch/retry-emails','--http-method','POST','--oidc-service-account-email','itc-worker-scheduler@'+PROJECT+'.iam.gserviceaccount.com','--oidc-token-audience',BASE+'/api/payment/launch/retry-emails','--attempt-deadline','240s'])
after=json.loads(g(['run','services','describe','itc-backend','--region','us-east1','--format=json']))['status'].get('traffic',[])
if before!=after:raise SystemExit('Production traffic changed concurrently; review before proceeding')
print(json.dumps({'backend':BASE,'webhook':BASE+'/api/partners/payment/webhook','worker':job,'productionChanged':False}))
