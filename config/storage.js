const { Storage } = require("@google-cloud/storage");

// En Cloud Run usa las credenciales del servicio automáticamente.
// En local usa GOOGLE_APPLICATION_CREDENTIALS (ruta al JSON de la service account).
const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID || undefined,
});

module.exports = storage;
