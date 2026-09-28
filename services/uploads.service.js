const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DRIVER = process.env.UPLOAD_DRIVER || "local";

function buildKey(originalname, prefix = 'experiences') {
  const ext = (path.extname(originalname || "") || ".jpg").toLowerCase();
  const rand = crypto.randomBytes(6).toString("hex");
  return `${prefix}/${Date.now()}-${rand}${ext}`;
}

// Sube un buffer y devuelve la URL pública.
async function uploadImage(file, prefix = 'experiences') {
  if (!file || !file.buffer) {
    throw new Error("Archivo inválido");
  }

  const key = buildKey(file.originalname, prefix);

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
  const dir = path.join(__dirname, "..", "uploads", prefix);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), file.buffer);

  const base = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  return `${base}/uploads/${prefix}/${filename}`;
}

async function uploadPrivatePdf(file) {
  if (!file?.buffer || file.mimetype !== 'application/pdf') throw new Error('Archivo PDF inválido');
  const key = buildKey(file.originalname || 'guia.pdf', 'guides');
  if (DRIVER === 'gcs') {
    const storage = require('../config/storage');
    const bucketName = process.env.GCS_BUCKET;
    if (!bucketName) throw new Error('GCS_BUCKET no configurado');
    await storage.bucket(bucketName).file(key).save(file.buffer, { contentType: 'application/pdf', resumable: false, metadata: { cacheControl: 'private, no-store' } });
    return { key, name: file.originalname, size: file.size };
  }
  const dir = path.join(__dirname, '..', 'uploads', 'guides');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, path.basename(key)), file.buffer);
  return { key, name: file.originalname, size: file.size };
}

function streamPrivatePdf(key, response) {
  let stream;
  if (DRIVER === 'gcs') {
    const storage = require('../config/storage');
    const bucketName = process.env.GCS_BUCKET;
    if (!bucketName) throw new Error('GCS_BUCKET no configurado');
    stream = storage.bucket(bucketName).file(key).createReadStream();
  } else {
    stream = fs.createReadStream(path.join(__dirname, '..', 'uploads', 'guides', path.basename(key)));
  }
  stream.pipe(response);
  return stream;
}

module.exports = { uploadImage, uploadPrivatePdf, streamPrivatePdf };
