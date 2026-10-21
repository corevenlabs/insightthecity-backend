"""Provision Apple runtime secrets without writing their values to logs or disk."""
import os
import subprocess

project = os.environ['PROJECT_ID']
region = os.environ['REGION']
service = os.environ['SERVICE']
def run(args, value=None, check=True):
    return subprocess.run(['gcloud', *args, '--project', project, '--quiet'], input=value, text=True, capture_output=True, check=check)

account = run(['run', 'services', 'describe', service, '--region', region, '--format=value(spec.template.spec.serviceAccountName)']).stdout.strip()
if not account:
    number = run(['projects', 'describe', project, '--format=value(projectNumber)']).stdout.strip()
    account = number + '-compute@developer.gserviceaccount.com'
for name in ('APPLE_PRIVATE_KEY', 'APPLE_TOKEN_ENCRYPTION_KEY'):
    value = os.environ.get(name, '')
    if not value:
        raise SystemExit('Missing required GitHub secret: ' + name)
    if run(['secrets', 'describe', name], check=False).returncode != 0:
        result = run(['secrets', 'create', name, '--replication-policy=automatic', '--data-file=-'], value=value, check=False)
        if result.returncode:
            raise SystemExit('Could not create Apple runtime secret: ' + name + '\n' + result.stderr.replace(value, '[redacted]'))
    result = run(['secrets', 'add-iam-policy-binding', name, '--member=serviceAccount:' + account, '--role=roles/secretmanager.secretAccessor'], check=False)
    if result.returncode:
        raise SystemExit('Could not grant runtime access to Apple secret: ' + name + '\n' + result.stderr.replace(value, '[redacted]'))
print('Apple runtime secrets are provisioned; values were not logged.')
