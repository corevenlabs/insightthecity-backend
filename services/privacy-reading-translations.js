const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..', 'legal', 'privacy-2026-10-31');
const source = require('../legal/privacy-2026-10-31/source.json');
const titles = { es: 'Política de Privacidad', en: 'Privacy Policy', pt: 'Política de Privacidade' };
const contents = Object.fromEntries(Object.keys(titles).map(language => [language, fs.readFileSync(path.join(root, `${language}.md`), 'utf8')]));

// Reading translations of ONE unchanged published policy. Never rewrite its record
// or acceptance history, and never override a later policy published by the admin.
function localizePrivacy(document, language) {
  if (!document || document.slug !== 'privacy' || !Object.hasOwn(contents, language)
      || document.id !== source.documentId || document.version !== source.version
      || new Date(document.publishedAt).toISOString() !== source.publishedAt
      || createHash('sha256').update(document.content).digest('hex') !== source.sourceSha256) return null;
  return {
    ...document,
    language,
    title: titles[language],
    content: contents[language],
    sourceLanguage: document.language,
    sourceContentLanguage: source.contentLanguage,
    sourceDocumentId: document.id,
    sourceVersion: document.version,
    sourceContentHash: source.sourceSha256,
    isTranslated: language !== source.contentLanguage,
  };
}
module.exports = { localizePrivacy };
