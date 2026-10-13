const fs = require('node:fs');
const assert = require('node:assert/strict');
const db = require('../config/db');
const document = JSON.parse(fs.readFileSync('legal/published/terms-en.json', 'utf8'));

async function main() {
  assert.equal(document.slug, 'terms');
  assert.equal(document.language, 'en');
  assert.equal((document.content.match(/^# /gm) || []).length, 18);
  assert.ok(!/\[[A-Z :]+\]/.test(document.content));
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('publish-app-terms-en'))");
    const current = await client.query("SELECT * FROM legal_documents WHERE slug='terms' AND language='en' AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1");
    let published = current.rows[0];
    if (!published || published.title !== document.title || published.content !== document.content) {
      const result = await client.query(`INSERT INTO legal_documents (slug, language, version, title, content, published_at)
        VALUES ('terms', 'en', (SELECT COALESCE(MAX(version),0)+1 FROM legal_documents WHERE slug='terms' AND language='en'), $1, $2, NOW()) RETURNING *`, [document.title, document.content]);
      published = result.rows[0];
    }
    assert.equal(published.content, document.content);
    await client.query('COMMIT');
    console.log(JSON.stringify({ id: published.id, slug: published.slug, language: published.language, version: published.version, publishedAt: published.published_at, sourceSha256: document.sourceSha256 }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.end());
