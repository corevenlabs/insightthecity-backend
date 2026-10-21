const { test } = require('node:test');
const assert = require('node:assert/strict');
const { imageName, safePart } = require('../services/partner-file-download.service');
test('image downloads identify business and preserve actual image type with unique filenames', () => {
  assert.equal(imageName('Café NY', { id: 12, kind: 'logo', mime: 'image/png' }), 'Cafe-NY-logo-12.png');
  assert.equal(imageName('Café NY', { id: 13, kind: 'photo', mime: 'image/jpeg' }), 'Cafe-NY-foto-13.jpg');
  assert.match(imageName('NY', { id: 14, kind: 'photo', mime: 'image/webp' }), /\.webp$/);
  assert.throws(() => imageName('NY', { mime: 'text/html' }));
});
test('ZIP entry names cannot contain paths or control characters', () => {
  const name = imageName('../../evil\\folder\r\n', { id: '../../15', kind: 'photo', mime: 'image/png' });
  assert.doesNotMatch(name, /[\\/\r\n]/);
  assert.equal(safePart('', 'ITC-CLUB'), 'ITC-CLUB');
});
