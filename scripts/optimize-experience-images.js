// One-off: replace oversized public experience photos with resized copies, without downtime.
//
//   node scripts/optimize-experience-images.js             dry run: only reports what would change
//   node scripts/optimize-experience-images.js --apply     writes copies and switches the URLs
//   node scripts/optimize-experience-images.js --rollback <map object key>
//
// Safety:
// - Originals are never modified or deleted, so every old URL keeps working (apps that cached
//   an old URL keep showing it) and a rollback only switches the URLs back.
// - Copies are written under experiences/optimized/ before the database changes, and the URL map
//   is saved to the bucket first (experiences/optimized/_maps/<timestamp>.json).
// - All URL switches happen in one transaction with the rows locked; a row edited meanwhile is
//   handled with its current value, and only exact URL strings that are in the map are replaced.
const db = require('../config/db');
const { optimizeImage } = require('../services/image-optimize');

const bucketName = process.env.GCS_BUCKET;
const PUBLIC = `https://storage.googleapis.com/${bucketName}/`;
const MIN_SAVING = 0.2; // skip photos that would shrink less than 20 %

const isCandidate = url => typeof url === 'string' && url.startsWith(`${PUBLIC}experiences/`) && !url.startsWith(`${PUBLIC}experiences/optimized/`);
const keyOf = url => decodeURIComponent(url.slice(PUBLIC.length));

// Replaces exact string values found in the map anywhere inside a JSON value.
function remap(value, map) {
  if (typeof value === 'string') return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : value;
  if (Array.isArray(value)) return value.map(item => remap(item, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, map)]));
  return value;
}
function collect(value, out) {
  if (typeof value === 'string') { if (isCandidate(value)) out.add(value); }
  else if (Array.isArray(value)) value.forEach(item => collect(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collect(item, out));
  return out;
}

const SOURCES = [
  { table: 'experiences', columns: ['image_url', 'gallery_urls'] },
  { table: 'featured_partnership', columns: ['image_url'] },
  { table: 'experience_drafts', columns: ['payload'] },
];

async function readRows(client, lock) {
  const rows = [];
  for (const { table, columns } of SOURCES) {
    const result = await client.query(`SELECT id, ${columns.join(', ')} FROM ${table}${lock ? ' FOR UPDATE' : ''}`);
    for (const row of result.rows) rows.push({ table, columns, row });
  }
  return rows;
}

// Switches every mapped URL inside one transaction. Returns the number of rows changed.
async function switchUrls(map) {
  const client = await db.connect();
  let changed = 0;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('optimize-experience-images'))");
    for (const { table, columns, row } of await readRows(client, true)) {
      const sets = [], values = [row.id];
      for (const column of columns) {
        const next = remap(row[column], map);
        if (JSON.stringify(next) === JSON.stringify(row[column])) continue;
        values.push(column === 'image_url' ? next : JSON.stringify(next));
        sets.push(`${column} = $${values.length}${column === 'image_url' ? '' : '::jsonb'}`);
      }
      if (!sets.length) continue;
      await client.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1`, values);
      changed++;
    }
    await client.query('COMMIT');
    return changed;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function optimizeAll(apply) {
  const bucket = require('../config/storage').bucket(bucketName);
  const client = await db.connect();
  let urls;
  try { urls = [...(await readRows(client, false)).reduce((set, { columns, row }) => { columns.forEach(c => collect(row[c], set)); return set; }, new Set())].sort(); }
  finally { client.release(); }

  const map = {};
  let before = 0, after = 0, skipped = 0;
  for (const url of urls) {
    const key = keyOf(url);
    const [exists] = await bucket.file(key).exists();
    if (!exists) { console.log(JSON.stringify({ skip: 'missing', key })); skipped++; continue; }
    const [buffer] = await bucket.file(key).download();
    const [meta] = await bucket.file(key).getMetadata();
    const image = await optimizeImage(buffer, meta.contentType);
    if (!image.optimized || image.buffer.length > buffer.length * (1 - MIN_SAVING)) { skipped++; continue; }
    const target = `experiences/optimized/${key.slice('experiences/'.length).replace(/\.[^./]+$/, '')}${image.ext}`;
    before += buffer.length; after += image.buffer.length;
    console.log(JSON.stringify({ key, fromKB: Math.round(buffer.length / 1024), toKB: Math.round(image.buffer.length / 1024), target }));
    if (apply) {
      const file = bucket.file(target);
      const [already] = await file.exists();
      if (!already) await file.save(image.buffer, { contentType: image.mime, resumable: false, metadata: { cacheControl: 'public, max-age=31536000' } });
    }
    map[url] = `${PUBLIC}${target}`;
  }
  console.log(JSON.stringify({ images: urls.length, optimized: Object.keys(map).length, skipped, beforeMB: +(before / 1048576).toFixed(1), afterMB: +(after / 1048576).toFixed(1) }));
  if (!apply || !Object.keys(map).length) return;

  const mapKey = `experiences/optimized/_maps/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await bucket.file(mapKey).save(JSON.stringify(map, null, 2), { contentType: 'application/json', resumable: false, metadata: { cacheControl: 'no-store' } });
  // Every copy must be readable before any URL points to it.
  for (const target of Object.values(map)) {
    const [exists] = await bucket.file(keyOf(target)).exists();
    if (!exists) throw new Error(`Copy missing, nothing switched: ${target}`);
  }
  console.log(JSON.stringify({ mapKey, rowsChanged: await switchUrls(map) }));
}

async function rollback(mapKey) {
  if (!/^experiences\/optimized\/_maps\/[\w-]+\.json$/.test(mapKey || '')) throw new Error('Pass the map key, e.g. experiences/optimized/_maps/2026-11-17T00-00-00-000Z.json');
  const [content] = await require('../config/storage').bucket(bucketName).file(mapKey).download();
  const reverse = Object.fromEntries(Object.entries(JSON.parse(content)).map(([from, to]) => [to, from]));
  console.log(JSON.stringify({ rolledBack: Object.keys(reverse).length, rowsChanged: await switchUrls(reverse) }));
}

async function main() {
  if (!bucketName) throw new Error('GCS_BUCKET is required');
  const args = process.argv.slice(2);
  if (args[0] === '--rollback') return rollback(args[1]);
  return optimizeAll(args.includes('--apply'));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.end());
module.exports = { remap, collect, isCandidate };
