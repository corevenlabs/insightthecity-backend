"""Read sanitized Cloud Run error logs only; no deployments, secret access or DB writes."""
import collections
import json
import re
import subprocess
import urllib.parse
query = 'resource.type="cloud_run_revision" AND resource.labels.service_name="itc-backend" AND (httpRequest.status>=500 OR logName="projects/itc-developer-502721/logs/run.googleapis.com%2Fstderr")'
r = subprocess.run(['gcloud','logging','read',query,'--project','itc-developer-502721','--freshness=24h','--limit=400','--format=json'],capture_output=True,text=True,check=True)
entries=json.loads(r.stdout)
def safe(value):
 s=str(value)
 s=re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[redacted-token]',s)
 s=re.sub(r'(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+','[redacted-key]',s)
 s=re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[redacted-email]',s)
 return s[:1200]
errors=[];counts=collections.Counter()
for e in entries:
 h=e.get('httpRequest',{})
 path=urllib.parse.urlsplit(h.get('requestUrl','')).path
 if h.get('status'):counts[(path,h['status'])]+=1
 msg=e.get('textPayload') or e.get('jsonPayload',{}).get('message','')
 if msg:errors.append({'timestamp':e.get('timestamp'),'revision':e.get('resource',{}).get('labels',{}).get('revision_name'),'message':safe(msg)})
print(json.dumps({'sample':'last 24h, at most 400 matching entries','entryCount':len(entries),'requests':[{'path':p,'status':s,'count':c} for (p,s),c in counts.items()],'serverMessages':errors},ensure_ascii=False))
