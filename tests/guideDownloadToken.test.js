const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-guide-download-secret';
const { createGuideDownloadToken, verifyGuideDownloadToken } = require('../services/guide-download-token.service');

test('el enlace temporal de guía solo funciona para la guía autorizada', () => {
  const token = createGuideDownloadToken(12, 34);
  const payload = verifyGuideDownloadToken(token, 12);
  assert.equal(payload.type, 'guide_download');
  assert.equal(payload.guideId, '12');
  assert.equal(payload.userId, '34');
  assert.throws(() => verifyGuideDownloadToken(token, 13), /inválido/);
});

test('un enlace de guía alterado es rechazado', () => {
  const token = createGuideDownloadToken(12, 34);
  assert.throws(() => verifyGuideDownloadToken(`${token}alterado`, 12));
});
