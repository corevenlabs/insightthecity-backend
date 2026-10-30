const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const db = require('../config/db');
const legal = require('../services/legal.service');
const { hash } = require('../services/content-language.service');

// Publishes the approved documents in legal/published (English source and Spanish translation).
// A slug + language only gets a new version when its text differs from the current published one.
const dir = path.join(__dirname, '../legal/published');
const documents = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));

function check(document) {
  assert.ok(legal.SLUGS.includes(document.slug), `slug ${document.slug}`);
  assert.ok(['en', 'es'].includes(document.language), `language ${document.language}`);
  assert.ok(document.title && document.content, `${document.slug}-${document.language} is empty`);
  assert.ok(document.language === 'en' ? !document.titlePt : document.titlePt, `${document.slug}-${document.language} Portuguese title`);
  const source = documents.find(d => d.slug === document.slug && d.language === 'en');
  assert.ok(source, `${document.slug} has no English source`);
  // A translation keeps the source structure, contacts, links, amounts and periods.
  const shape = text => [/^# /gm, /^- /gm, /\*\*/g].map(re => (text.match(re) || []).length).join('/') + '|' + text.split('\n\n').length;
  const tokens = text => (text.match(/[\w.+-]+@[\w.-]+\.\w+|https?:\/\/[^\s)]+|US\$[\d.]+|\b\d+\b/g) || []).sort().join(',');
  assert.equal(shape(document.content), shape(source.content), `${document.slug}-${document.language} structure`);
  assert.equal(tokens(document.content), tokens(source.content), `${document.slug}-${document.language} contacts, links or figures`);
}

async function main() {
  documents.forEach(check);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('publish-legal-documents'))");
    for (const document of documents) {
      const current = await client.query('SELECT * FROM legal_documents WHERE slug=$1 AND language=$2 AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1', [document.slug, document.language]);
      let published = current.rows[0];
      if (!published || published.title !== document.title || published.content !== document.content) {
        const result = await client.query(`INSERT INTO legal_documents (slug, language, version, title, content, published_at)
          VALUES ($1, $2, (SELECT COALESCE(MAX(version),0)+1 FROM legal_documents WHERE slug=$1::varchar AND language=$2::varchar), $3, $4, NOW()) RETURNING *`,
          [document.slug, document.language, document.title, document.content]);
        published = result.rows[0];
      }
      assert.equal(published.content, document.content);
      if (document.titlePt) {
        // Reviewed Portuguese title for the translation served from the Spanish row (the model may copy a title it reads as Portuguese).
        await client.query(`INSERT INTO content_translations (source_hash, language, translated_text) VALUES ($1, 'pt', $2)
          ON CONFLICT (source_hash, language) DO UPDATE SET translated_text = EXCLUDED.translated_text`, [hash(document.title, false), document.titlePt]);
      }
      console.log(JSON.stringify({ id: published.id, slug: published.slug, language: published.language, version: published.version, publishedAt: published.published_at }));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.end());
module.exports = { documents, check };
