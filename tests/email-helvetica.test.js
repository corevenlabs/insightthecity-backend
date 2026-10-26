const { test } = require('node:test');
const assert = require('node:assert/strict');
const { email, EMAIL_STACK } = require('../services/brand-typography');
const banners = require('../config/email-helvetica-banners.json');
const fs = require('node:fs');
const path = require('node:path');
test('all email text uses brand Black weight, readable sizes and preserves links and copy', () => {
  const result = email({ text: 'Original message', subject: 'Original subject', html: '<html><head></head><body><h1 style="font-size:48px">Título</h1><p style="font-size:16px">Texto</p><a href="https://example.com" style="font-size:12px">Enlace</a></body></html>' });
  assert.equal(result.text, 'Original message');
  assert.equal(result.subject, 'Original subject');
  assert(result.html.includes(EMAIL_STACK));
  assert.match(result.html, /font-size:34px/);
  assert.match(result.html, /font-size:18px/);
  assert.match(result.html, /font-size:14px/);
  assert.match(result.html, /href="https:\/\/example.com"/);
  assert.equal(email(result).html, result.html);
});
test('all mapped banners exist and email rendering upgrades image assets without changing the logo', () => {
  for (const [before, after] of Object.entries(banners)) {
    assert(fs.existsSync(path.join(__dirname, '../public/email', after)), after);
    const result = email({ html: `<html><head></head><body><img src="https://example.com/email-assets/${before}"><img src="https://example.com/email-assets/itc-club-logo-v1.png"></body></html>` });
    assert(result.html.includes(after));
    assert(result.html.includes('/email-assets/itc-club-logo-v1.png'));
  }
});

test('banner headings use sentence case in Spanish, English and Portuguese without changing the brand', () => {
  const spec = require('../config/email-banner-spec.json');
  for (const [, lines] of spec) {
    const headline = lines.join(' ').replace(/ITC CLUB/g, '');
    assert.notEqual(headline, headline.toLocaleUpperCase(), headline);
  }
  for (const lang of ['es', 'en', 'pt']) {
    const banner = spec.find(([name]) => name === `membership-welcome-${lang}-phone-v2.png`);
    assert(banner, lang);
    assert.equal(banner[1][0][0], banner[1][0][0].toLocaleUpperCase());
  }
  const brand = email({ html: '<html><head></head><body><h1>Welcome to ITC CLUB!</h1><p>MY BUSINESS · ABC123</p></body></html>' });
  assert.match(brand.html, /Welcome to ITC CLUB!/);
  assert.match(brand.html, /MY BUSINESS · ABC123/);
});
