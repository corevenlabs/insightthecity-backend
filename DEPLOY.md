# Deploy — ITC Club

Proyecto GCP: **itc-developer-502721** (número `1031252664334`), región **us-east1**.

Cada push a `main` dispara el workflow correspondiente:

| Repo | Workflow | Destino |
|---|---|---|
| `insightthecity-backend` | `.github/workflows/deploy.yml` | Cloud Run `itc-backend` |
| `insightthecity-panel` | `.github/workflows/deploy.yml` | Cloud Run `itc-panel` |
| `insightthecity-frontend` | `.github/workflows/eas-update.yml` | EAS Update, canal `preview` |

## Ya configurado en GCP

- APIs habilitadas: `iam`, `iamcredentials`, `sts`, `sqladmin`.
- Service account de despliegue: `github-deployer@itc-developer-502721.iam.gserviceaccount.com`
  con los roles `run.admin`, `artifactregistry.writer`, `iam.serviceAccountUser`,
  `cloudsql.client`, `secretmanager.secretAccessor`, `storage.objectAdmin`.
- Workload Identity Federation (sin claves JSON):
  - Pool `github`, provider `github` (OIDC contra `token.actions.githubusercontent.com`).
  - Condición: solo repos cuyo owner sea `corevenlabs`.
  - Pueden impersonar la SA: `corevenlabs/insightthecity-backend` y `corevenlabs/insightthecity-panel`.
  - Identificador usado en los workflows:
    `projects/1031252664334/locations/global/workloadIdentityPools/github/providers/github`

## BLOQUEADO: falta habilitar la facturación

El proyecto **no tiene cuenta de facturación vinculada** (`billingEnabled: false`) y la única
cuenta visible (`010031-5D5C10-06244A`) está **cerrada**. Sin eso no se pueden habilitar
Cloud Run, Artifact Registry ni Cloud SQL, así que nada se puede desplegar todavía.

El cliente (o quien administre la facturación) debe vincular una cuenta activa en
https://console.cloud.google.com/billing/linkedaccount?project=itc-developer-502721

## Pasos pendientes (una vez haya facturación)

```bash
P=itc-developer-502721
REGION=us-east1

# 1. APIs que requieren facturación
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com compute.googleapis.com --project $P

# 2. Registro de imágenes
gcloud artifacts repositories create itc --repository-format=docker \
  --location=$REGION --project $P

# 3. Base de datos (db-f1-micro es lo más barato; subir a db-g1-small si hace falta)
gcloud sql instances create itc-postgres --database-version=POSTGRES_16 \
  --tier=db-f1-micro --region=$REGION --storage-size=10GB --project $P
gcloud sql databases create itc --instance=itc-postgres --project $P
gcloud sql users create itc_app --instance=itc-postgres --password='<CLAVE>' --project $P

# 4. Bucket de imágenes (UPLOAD_DRIVER=gcs)
gcloud storage buckets create gs://itc-developer-502721-media --location=$REGION --project $P
gcloud storage buckets add-iam-policy-binding gs://itc-developer-502721-media \
  --member=allUsers --role=roles/storage.objectViewer   # lectura pública de las imágenes

# 5. Secretos que consume Cloud Run
for S in DB_PASSWORD JWT_SECRET OPENAI_API_KEY STRIPE_SECRET_KEY STRIPE_PRICE_ID GOOGLE_PLACES_API_KEY; do
  echo -n "<valor>" | gcloud secrets create $S --data-file=- --project $P
done
```

En GitHub:

- Los tres repos: nada de claves de GCP (WIF no las necesita).
- `insightthecity-backend` → secret **`DB_PASSWORD`** (lo usa el paso de migración vía Cloud SQL Auth Proxy).
- `insightthecity-panel` → variable **`VITE_API_URL`** con la URL del backend + `/api`
  (ej. `https://itc-backend-xxxx-ue.a.run.app/api`). Es *variable*, no secret: se hornea en el bundle.
- `insightthecity-frontend` → secret **`EXPO_TOKEN`** (expo.dev → Account settings → Access tokens).

## Notas

- El workflow del backend corre `npm run db:migrate` antes de desplegar; `schema.sql` es
  idempotente (`CREATE ... IF NOT EXISTS`, `DROP TRIGGER IF EXISTS`), así que se puede repetir.
- La semilla (`npm run db:seed`) **no** corre en CI: borra y recarga las 19 experiencias.
  Ejecutarla sólo la primera vez, a mano.
- Las imágenes se sirven desde el bucket en producción (`UPLOAD_DRIVER=gcs`); el disco de
  Cloud Run es efímero, por eso `uploads/` está en `.gitignore` y en `.dockerignore`.
