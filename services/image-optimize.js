// Public experience photos are shown on phones (about 1200 px wide at most), but staff upload
// camera originals (up to 7600 px, 4 MB). Store a resized copy so opening an experience stays fast.
const MAX_SIDE = 1600;
const JPEG_QUALITY = 80;
const WEBP_QUALITY = 80;
const SMALL_BYTES = 500 * 1024;
// Animated GIFs and already-small files are kept as uploaded.
const OPTIMIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

// Returns { buffer, mime, ext } for the stored file. Never throws: if the image cannot be
// processed the original is returned, so an upload never fails because of this step.
async function optimizeImage(buffer, mime) {
  const original = { buffer, mime, ext: extFor(mime), optimized: false };
  if (!Buffer.isBuffer(buffer) || !OPTIMIZABLE.has(mime)) return original;
  try {
    const sharp = require('sharp');
    // Staff uploads are rare; keep memory low on the 512 MiB Cloud Run instance.
    sharp.cache(false);
    sharp.concurrency(1);
    const image = sharp(buffer, { failOn: 'none', limitInputPixels: 100_000_000 });
    const { width = 0, height = 0, hasAlpha } = await image.metadata();
    // Already phone-sized and light: keep it untouched (no extra JPEG generation loss).
    if (Math.max(width, height) <= MAX_SIDE && buffer.length <= SMALL_BYTES) return original;
    // rotate() applies the EXIF orientation; metadata (including GPS) is dropped by default.
    const resized = image.rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
    const out = hasAlpha
      ? { buffer: await resized.webp({ quality: WEBP_QUALITY }).toBuffer(), mime: 'image/webp', ext: '.webp' }
      : { buffer: await resized.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer(), mime: 'image/jpeg', ext: '.jpg' };
    // Keep the original when it is already small and not oversized.
    if (out.buffer.length >= buffer.length && Math.max(width, height) <= MAX_SIDE) return original;
    return { ...out, optimized: true };
  } catch (error) {
    console.error(JSON.stringify({ severity: 'WARNING', message: `Image optimization skipped: ${String(error?.message || error).slice(0, 200)}` }));
    return original;
  }
}

function extFor(mime) {
  return { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }[mime] || '.jpg';
}

module.exports = { optimizeImage, MAX_SIDE };
