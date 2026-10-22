"""Operational checks only: no migrations, deployment, secret access or user mutation."""
import collections
import json
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

PROJECT = 'itc-developer-502721'
BASE = 'https://itc-backend-1031252664334.us-east1.run.app'
def read(args):
    result = subprocess.run(['gcloud', *args, '--project', PROJECT], capture_output=True, text=True)
    if result.returncode:
        print(result.stderr)
        raise SystemExit(result.returncode)
    return json.loads(result.stdout)
def safe(value):
    value = str(value)
    value = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[redacted-token]', value)
    value = re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[redacted-email]', value)
    return value[:800]
spec = read(['run', 'services', 'describe', 'itc-backend', '--region', 'us-east1', '--format=json'])
revision = spec['status']['latestReadyRevisionName']
print(json.dumps({'revision': revision, 'latestCreatedRevision': spec['status'].get('latestCreatedRevisionName'), 'traffic': [{k:v for k,v in item.items() if k in ('revisionName','percent','latestRevision')} for item in spec['status'].get('traffic', [])]}))
prefix = 'resource.type="cloud_run_revision" AND resource.labels.service_name="itc-backend" AND resource.labels.revision_name="' + revision + '"'
entries = read(['logging', 'read', prefix + ' AND (httpRequest.requestUrl:"/api/users/apple/" OR textPayload:"[apple]" OR textPayload:"Apple" OR textPayload:"invalid_client" OR textPayload:"invalid_grant")', '--freshness=24h', '--limit=300', '--format=json'])
counts = collections.Counter()
failures = []
markers = 0
for entry in entries:
    request = entry.get('httpRequest', {})
    if request:
        path = urllib.parse.urlsplit(request.get('requestUrl', '')).path
        status = request.get('status')
        counts[(path, status)] += 1
        if isinstance(status,int) and status >= 400:
            failures.append({'timestamp': entry.get('timestamp'), 'path': path, 'status': status})
    text = entry.get('textPayload', '')
    if '[apple] Runtime private key readable' in text:
        markers += 1
    elif text:
        failures.append({'timestamp': entry.get('timestamp'), 'severity': entry.get('severity'), 'message': safe(text)})
print(json.dumps({'sample': 'latest 300 matching entries, last 24h, current revision', 'entries': len(entries), 'startupMarkers': markers, 'http': [{'path': path, 'status':status, 'count':count} for (path,status),count in counts.items()], 'authenticationFailures':failures[-30:]}, ensure_ascii=False))
errors = read(['logging', 'read', prefix + ' AND severity>=ERROR', '--freshness=24h', '--limit=20', '--format=json'])
print(json.dumps({'recentRevisionErrors': [{'timestamp':e.get('timestamp'), 'severity':e.get('severity'), 'path':urllib.parse.urlsplit(e.get('httpRequest',{}).get('requestUrl','')).path, 'status':e.get('httpRequest',{}).get('status'), 'message':safe(e.get('textPayload') or e.get('jsonPayload',{}).get('message') or '')} for e in errors]}, ensure_ascii=False))
checks = [('/health','GET',None,200),('/api/payment/plan','GET',None,200),('/api/users/me','GET',None,401),('/api/users/apple/login','POST',{'nonce':'0'*64,'identityToken':'invalid-read-only-verification'},401)]
for path,method,body,expected in checks:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            status = response.status
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        status = error.code
        payload = json.load(error)
    if status != expected:
        raise SystemExit('Unexpected HTTP response: '+path+' '+str(status)+' '+safe(payload.get('message','')))
    detail = {'path': path, 'method': method, 'status': status, 'expected': expected}
    if path == '/api/payment/plan':
        detail['plan'] = {key:payload.get(key, payload.get('plan',{}).get(key)) for key in ('amountCents','currency','interval')}
    print(json.dumps(detail))
print('Read-only verification complete. No accounts, subscriptions, memberships or user data were changed. Invalid Apple credential is rejected before database access.')
