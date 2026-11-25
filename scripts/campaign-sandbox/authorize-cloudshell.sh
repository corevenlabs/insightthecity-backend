#!/usr/bin/env bash
# Run once in Google Cloud Shell as the project owner. No keys/passwords are printed.
# Grants are limited to the new campaign-test identity, secrets, bucket and worker.
set -euo pipefail
ITC_TEST_PROJECT=itc-developer-502721
ITC_TEST_RUNTIME="itc-campaigns-test@${ITC_TEST_PROJECT}.iam.gserviceaccount.com"
ITC_TEST_DEPLOYER="github-deployer@${ITC_TEST_PROJECT}.iam.gserviceaccount.com"
ITC_TEST_BUCKET="${ITC_TEST_PROJECT}-campaign-tests-media"
ITC_TEST_BASE=https://itc-campaigns-test-backend-1031252664334.us-east1.run.app
gcloud secrets describe PARTNER_CAMPAIGNS_STRIPE_TEST_SECRET_KEY --project "$ITC_TEST_PROJECT" >/dev/null
if ! gcloud iam service-accounts describe "$ITC_TEST_RUNTIME" --project "$ITC_TEST_PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create itc-campaigns-test --display-name='ITC Campaign Sandbox Runtime' --project "$ITC_TEST_PROJECT"
fi
gcloud projects add-iam-policy-binding "$ITC_TEST_PROJECT" --member="serviceAccount:$ITC_TEST_RUNTIME" --role=roles/cloudsql.client --condition=None --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$ITC_TEST_RUNTIME" --member="serviceAccount:$ITC_TEST_DEPLOYER" --role=roles/iam.serviceAccountUser --project "$ITC_TEST_PROJECT" --quiet >/dev/null
for ITC_TEST_SECRET in PARTNER_CAMPAIGNS_STRIPE_TEST_SECRET_KEY PARTNER_CAMPAIGNS_TEST_DB_PASSWORD PARTNER_CAMPAIGNS_TEST_JWT_SECRET PARTNER_CAMPAIGNS_TEST_WEBHOOK_SECRET; do
  if ! gcloud secrets describe "$ITC_TEST_SECRET" --project "$ITC_TEST_PROJECT" >/dev/null 2>&1; then
    gcloud secrets create "$ITC_TEST_SECRET" --replication-policy=automatic --project "$ITC_TEST_PROJECT" --quiet
  fi
  gcloud secrets add-iam-policy-binding "$ITC_TEST_SECRET" --member="serviceAccount:$ITC_TEST_DEPLOYER" --role=roles/secretmanager.admin --project "$ITC_TEST_PROJECT" --quiet >/dev/null
    gcloud secrets add-iam-policy-binding "$ITC_TEST_SECRET" --member="serviceAccount:$ITC_TEST_RUNTIME" --role=roles/secretmanager.secretAccessor --project "$ITC_TEST_PROJECT" --quiet >/dev/null
done
if ! gcloud storage buckets describe "gs://$ITC_TEST_BUCKET" --project "$ITC_TEST_PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$ITC_TEST_BUCKET" --location=us-east1 --uniform-bucket-level-access --project "$ITC_TEST_PROJECT" --quiet
fi
gcloud storage buckets add-iam-policy-binding "gs://$ITC_TEST_BUCKET" --member="serviceAccount:$ITC_TEST_RUNTIME" --role=roles/storage.objectUser --project "$ITC_TEST_PROJECT" --quiet >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$ITC_TEST_BUCKET" --member="serviceAccount:$ITC_TEST_DEPLOYER" --role=roles/storage.admin --project "$ITC_TEST_PROJECT" --quiet >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$ITC_TEST_BUCKET" --member=allUsers --role=roles/storage.objectViewer --project "$ITC_TEST_PROJECT" --quiet >/dev/null
ITC_TEST_JOB_ACTION=create
if gcloud scheduler jobs describe itc-campaigns-test-worker --location=us-east1 --project "$ITC_TEST_PROJECT" >/dev/null 2>&1; then ITC_TEST_JOB_ACTION=update; fi
gcloud scheduler jobs "$ITC_TEST_JOB_ACTION" http itc-campaigns-test-worker --location=us-east1 --schedule='*/10 * * * *' --uri="$ITC_TEST_BASE/api/payment/launch/retry-emails" --http-method=POST --oidc-service-account-email="itc-worker-scheduler@$ITC_TEST_PROJECT.iam.gserviceaccount.com" --oidc-token-audience="$ITC_TEST_BASE/api/payment/launch/retry-emails" --attempt-deadline=240s --project "$ITC_TEST_PROJECT" --quiet >/dev/null
echo 'LISTO: permisos y recursos iniciales de campañas de prueba preparados. No se reemplazaron secretos ni servicios de producción.'
