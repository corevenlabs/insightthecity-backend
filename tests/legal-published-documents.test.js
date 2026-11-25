const test = require('node:test');
const assert = require('node:assert/strict');

test('cada documento legal publicado tiene su original en inglés y la traducción conserva su estructura', () => {
  const { documents, check } = require('../scripts/publish-legal-documents');
  assert.deepEqual(documents.map(d => `${d.slug}-${d.language}`), ['accessibility-en', 'accessibility-es', 'privacy-en', 'privacy-es', 'privacy-pt', 'subscription-en', 'subscription-es', 'terms-en', 'terms-es']);
  documents.forEach(check);
  const terms = documents.find(d => d.slug === 'terms' && d.language === 'en');
  assert.throws(() => check({ ...terms, language: 'es', titlePt: 'Termos', content: terms.content.replace('ITCClub@insightthecity.com', 'otro@example.com') }), /contacts, links or figures/);
});

test('the privacy policy is one version with its own text in the three languages', async () => {
  const { documents, check } = require('../scripts/publish-legal-documents');
  const privacy = documents.filter(d => d.slug === 'privacy');
  for (const [i, [language, date]] of [['en', 'November 25, 2026'], ['es', '25 de noviembre de 2026'], ['pt', '25 de novembro de 2026']].entries()) {
    assert.equal(privacy[i].language, language);
    assert.equal(privacy[i].version, 6);
    assert.ok(privacy[i].content.includes(`** ${date}
`));
    assert.deepEqual([...privacy[i].content.matchAll(/^# (\d+) /gm)].map(m => Number(m[1])), Array.from({ length: 16 }, (_, n) => n + 1));
    assert.throws(() => check({ ...privacy[i], version: 7 }), /version/);
  }
  // Each reader, and each new acceptance, gets its own record: the October 31 translations no longer apply.
  const db = require('../config/db'), legal = require('../services/legal.service');
  const original = db.query;
  const rows = privacy.map((d, i) => ({ ...d, id: 100 + i, published_at: '2026-11-26T00:00:00.000Z' }));
  const october = { id: 18, slug: 'privacy', language: 'es', version: 5, title: 'x', content: 'x', published_at: '2026-10-31T16:36:56.522Z' };
  db.query = async (sql, params) => ({ rows: params.length === 1 ? [rows.at(-1)] : [...rows, october].filter(d => params[1].includes(d.language)).sort((a, b) => (b.language === params[2]) - (a.language === params[2]) || (a.published_at < b.published_at ? 1 : -1)).slice(0, 1) });
  try {
    for (const row of rows) {
      const shown = await legal.getCurrent('privacy', row.language, { cacheOnly: true });
      assert.deepEqual([shown.id, shown.language, shown.version, shown.title, shown.content, shown.isTranslated], [row.id, row.language, 6, row.title, row.content, undefined]);
    }
  } finally { db.query = original; }
});
