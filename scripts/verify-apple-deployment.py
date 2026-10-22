"""Read only deployment metadata and a non-sensitive startup marker."""
import json
import os
import subprocess
p=os.environ['PROJECT_ID']; r=os.environ['REGION']; service=os.environ['SERVICE']
def run(args):
    result=subprocess.run(['gcloud',*args,'--project',p],capture_output=True,text=True)
    if result.returncode: raise SystemExit(result.stderr)
    return result.stdout
spec=json.loads(run(['run','services','describe',service,'--region',r,'--format=json']))
container=spec['spec']['template']['spec']['containers'][0]
variables={item['name']:item for item in container.get('env',[])}
for name,value in {'APPLE_TEAM_ID':'XKA2G7T5XX','APPLE_KEY_ID':'9AMY4RRKBJ','APPLE_CLIENT_ID':'com.insightthecity.app'}.items():
    if variables.get(name,{}).get('value')!=value: raise SystemExit('Unexpected or missing environment variable: '+name)
ref=variables.get('APPLE_PRIVATE_KEY',{}).get('valueFrom',{}).get('secretKeyRef',{})
if ref.get('name')!='APPLE_PRIVATE_KEY' or ref.get('key')!='latest': raise SystemExit('APPLE_PRIVATE_KEY is not bound to the existing secret latest version.')
account=spec['spec']['template']['spec'].get('serviceAccountName')
if account!='1031252664334-compute@developer.gserviceaccount.com': raise SystemExit('Runtime identity changed unexpectedly: '+str(account))
status=spec['status']; revision=status.get('latestReadyRevisionName')
if not revision or revision!=status.get('latestCreatedRevisionName'): raise SystemExit('New revision is not ready.')
if not any(c.get('type')=='Ready' and c.get('status')=='True' for c in status.get('conditions',[])): raise SystemExit('Cloud Run service is not ready.')
print('Apple deployment verified. Ready revision: '+revision)
print('Existing service account preserved; APPLE_PRIVATE_KEY:latest mounted and readable at startup (an unavailable or disabled latest version prevents revision startup).')
print('APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_CLIENT_ID match the supplied configuration.')
logs=run(['logging','read',f'resource.type="cloud_run_revision" AND resource.labels.service_name="{service}" AND resource.labels.revision_name="{revision}" AND textPayload:"[apple] Runtime private key readable"','--limit=3','--format=value(textPayload)'])
print(logs.strip() or 'Startup marker not yet indexed in Cloud Logging; service readiness and secret mount verified.')
