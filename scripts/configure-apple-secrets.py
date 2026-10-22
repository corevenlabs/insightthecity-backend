"""Check the existing runtime identity; never create or rewrite Apple secrets or IAM."""
import os
import subprocess
project = os.environ['PROJECT_ID']
result = subprocess.run(['gcloud', 'run', 'services', 'describe', os.environ['SERVICE'], '--project', project, '--region', os.environ['REGION'], '--format=value(spec.template.spec.serviceAccountName)'], capture_output=True, text=True)
if result.returncode:
    raise SystemExit(result.stderr)
account = result.stdout.strip() or '1031252664334-compute@developer.gserviceaccount.com'
if account != '1031252664334-compute@developer.gserviceaccount.com':
    raise SystemExit('Unexpected runtime service account: ' + account + '. No identity changes were made.')
print('Existing runtime service account verified: ' + account)
print('APPLE_PRIVATE_KEY:latest will be read by Cloud Run at startup. Disabled/missing versions or denied runtime access will prevent the new revision from becoming ready.')
