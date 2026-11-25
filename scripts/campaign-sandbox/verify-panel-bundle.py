import re,urllib.request
base='https://itc-panel-1031252664334.us-east1.run.app'
with urllib.request.urlopen(base,timeout=30) as r:page=r.read().decode()
script=re.search(r'<script[^>]+src="([^"]+)"',page).group(1)
with urllib.request.urlopen(base+script,timeout=30) as r:bundle=r.read().decode()
if '/partner-campaign-test' not in bundle or 'Probar sin cobros' not in bundle:raise SystemExit('Unified campaign panel not deployed; duplicate service preserved')
print('Current administrator panel includes inline Stripe testing.')
