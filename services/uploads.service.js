const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DRIVER = process.env.UPLOAD_DRIVER || "local";

function buildKey(originalname) {
  const ext = (path.extname(originalname || "") || ".jpg").toLowerCase();
  const rand = crypto.randomBytes(6).toString("hex");
  return `experiences/${Date.now()}-${rand}${ext}`;
}

// Sube un buffer y devuelve la URL pública.
async function uploadImage(file) {
  if (!file || !file.buffer) {
    throw new Error("Archivo inválido");
  }

  const key = buildKey(file.originalname);

  if (DRIVER === "gcs") {
    const storage = require("../config/storage");
    const bucketName = process.env.GCS_BUCKET;
    if (!bucketName) throw new Error("GCS_BUCKET no configurado");

    const blob = storage.bucket(bucketName).file(key);
    await blob.save(file.buffer, {
      contentType: file.mimetype,
      resumable: false,
      metadata: { cacheControl: "public, max-age=31536000" },
    });

    return `https://storage.googleapis.com/${bucketName}/${key}`;
  }

  // Driver local (desarrollo)
  const filename = key.split("/").pop();
  const dir = path.join(__dirname, "..", "uploads", "experiences");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), file.buffer);

  const base = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  return `${base}/uploads/experiences/${filename}`;
}

module.exports = { uploadImage };
