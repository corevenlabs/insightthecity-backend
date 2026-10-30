const test = require('node:test');
const assert = require('node:assert/strict');

test('la página pública de un documento legal ofrece ES/EN/PT y marca el idioma mostrado', async () => {
  const legal = require('../services/legal.service');
  const { page } = require('../controllers/legal.controller');
  const original = legal.getCurrent;
  legal.getCurrent = async (slug, language) => ({ id: 1, slug, language, version: 2, title: 'Privacy Policy', content: '# One\n\nText.', publishedAt: '2026-10-30T00:00:00Z' });
  try {
    let html;
    const res = { set() { return this; }, type() { return this; }, status() { return this; }, send(body) { html = body; } };
    await page({ params: { slug: 'privacy' }, query: { lang: 'en' } }, res, (e) => { throw e; });
    for (const code of ['es', 'en', 'pt']) assert.ok(html.includes(`href="/legal/privacy?lang=${code}"`), code);
    assert.match(html, /lang="en" aria-current="page">EN</);
    assert.doesNotMatch(html, /lang="es" aria-current/);
    assert.match(html, /aria-label="Language"/);
    require('node:fs').writeFileSync(process.env.LEGAL_PAGE_PREVIEW || require('node:os').devNull, html);
  } finally {
    legal.getCurrent = original;
  }
});
