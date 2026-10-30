const test = require('node:test');
const assert = require('node:assert/strict');

test('cada documento legal publicado tiene su original en inglés y la traducción conserva su estructura', () => {
  const { documents, check } = require('../scripts/publish-legal-documents');
  assert.deepEqual(documents.map(d => `${d.slug}-${d.language}`), ['accessibility-en', 'accessibility-es', 'privacy-en', 'privacy-es', 'subscription-en', 'subscription-es', 'terms-en', 'terms-es']);
  documents.forEach(check);
  const terms = documents.find(d => d.slug === 'terms' && d.language === 'en');
  assert.throws(() => check({ ...terms, language: 'es', titlePt: 'Termos', content: terms.content.replace('ITCClub@insightthecity.com', 'otro@example.com') }), /contacts, links or figures/);
});
