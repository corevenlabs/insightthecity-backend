const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { optimizeImage, MAX_SIDE } = require('../services/image-optimize');

test('large camera photos are resized, re-encoded as JPEG and lose EXIF metadata', async () => {
  const photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .jpeg({ quality: 95 }).withExif({ IFD0: { Make: 'TestCam' } }).toBuffer();
  const out = await optimizeImage(photo, 'image/jpeg');
  assert.equal(out.optimized, true);
  assert.equal(out.mime, 'image/jpeg');
  assert.ok(out.buffer.length < photo.length / 3, `${out.buffer.length} vs ${photo.length}`);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(Math.max(meta.width, meta.height), MAX_SIDE);
  assert.equal(meta.width / meta.height, 4 / 3);
  assert.equal(meta.exif, undefined);
});

test('transparent images stay transparent as WebP', async () => {
  const png = await sharp({ create: { width: 3000, height: 3000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const out = await optimizeImage(png, 'image/png');
  assert.equal(out.mime, 'image/webp');
  assert.equal((await sharp(out.buffer).metadata()).hasAlpha, true);
});

test('small images, GIFs and unreadable files are kept as uploaded', async () => {
  const small = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#000' } }).jpeg().toBuffer();
  assert.equal((await optimizeImage(small, 'image/jpeg')).buffer, small);
  const gif = Buffer.from('GIF89a-not-processed');
  assert.equal((await optimizeImage(gif, 'image/gif')).buffer, gif);
  const original = console.error; console.error = () => {};
  try {
    const broken = Buffer.from([255, 216, 255, 0, 1, 2]);
    const out = await optimizeImage(broken, 'image/jpeg');
    assert.equal(out.buffer, broken);
    assert.equal(out.optimized, false);
  } finally { console.error = original; }
});

test('the migration only remaps exact experience photo URLs from the public bucket', () => {
  process.env.GCS_BUCKET = 'demo-bucket';
  delete require.cache[require.resolve('../scripts/optimize-experience-images')];
  const { remap, collect, isCandidate } = require('../scripts/optimize-experience-images');
  const a = 'https://storage.googleapis.com/demo-bucket/experiences/1-a.jpg';
  const b = 'https://storage.googleapis.com/demo-bucket/experiences/optimized/1-a.jpg';
  assert.equal(isCandidate(a), true);
  assert.equal(isCandidate(b), false);
  assert.equal(isCandidate('https://storage.googleapis.com/demo-bucket/avatars/1/x.jpg'), false);
  assert.equal(isCandidate('https://example.com/experiences/1-a.jpg'), false);
  const payload = { title: a, images: [a, 'https://other.example/x.jpg'], nested: { image: a, note: `see ${a}` } };
  assert.deepEqual([...collect(payload, new Set())], [a]);
  const next = remap(payload, { [a]: b });
  assert.deepEqual(next.images, [b, 'https://other.example/x.jpg']);
  assert.equal(next.nested.image, b);
  assert.equal(next.nested.note, `see ${a}`);
});
