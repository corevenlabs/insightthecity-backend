const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const service = require('../services/benefits.service');
const experiences = require('../controllers/experiences.controller');
const { validationPage } = require('../controllers/benefits.controller');

test('el token del QR se guarda como SHA-256 y nunca como valor legible', () => {
  const token = 'token-super-secreto';
  const expected = crypto.createHash('sha256').update(token).digest('hex');
  assert.equal(service.hashToken(token), expected);
  assert.equal(service.hashToken(token).length, 64);
  assert.ok(!service.hashToken(token).includes(token));
});

test('clasifica QR válido, canjeado, vencido y revocado', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(service.state({ expires_at: future }), 'valid');
  assert.equal(service.state({ expires_at: future, redeemed_at: new Date() }), 'redeemed');
  assert.equal(service.state({ expires_at: past }), 'expired');
  assert.equal(service.state({ expires_at: future, revoked_at: new Date() }), 'expired');
  assert.equal(service.state(null), 'invalid');
});

test('panel exige HTTPS para enlace externo y acepta QR', () => {
  assert.match(experiences.validateMemberBenefit({ benefitAction: 'external', benefitUrl: 'http://example.com' }, false), /https/);
  assert.equal(experiences.validateMemberBenefit({ benefitAction: 'external', benefitUrl: 'https://example.com' }, false), null);
  assert.equal(experiences.validateMemberBenefit({ benefitAction: 'qr', benefitInstructions: 'Mostrar al personal' }, false), null);
});

test('inventario QR valida cantidades, límites y fechas', () => {
  assert.equal(experiences.validateMemberBenefit({ benefitAction: 'qr', couponInventoryMode: 'limited', couponTotal: 50, couponPerUser: 1, couponLowStock: 10 }, false), null);
  assert.match(experiences.validateMemberBenefit({ benefitAction: 'qr', couponInventoryMode: 'limited' }, false), /cantidad total/i);
  assert.match(experiences.validateMemberBenefit({ benefitAction: 'qr', couponInventoryMode: 'limited', couponTotal: -1 }, false), /couponTotal/);
  assert.match(experiences.validateMemberBenefit({ benefitAction: 'qr', couponInventoryMode: 'unlimited', couponPerUser: 0 }, false), /couponPerUser/);
  assert.match(experiences.validateMemberBenefit({ couponStartsAt: '2026-09-27T12:00:00Z', couponEndsAt: '2026-09-26T12:00:00Z' }, false), /posterior/);
});

test('la página escaneada no expone datos personales y solo permite canjear códigos válidos', () => {
  const record = { title: 'Museo', member_benefit: '20% OFF', member_benefit_details: 'Una visita', location: 'NY', expires_at: new Date(Date.now() + 60_000) };
  const valid = validationPage(record, 'secret', 'valid');
  assert.match(valid, /CONFIRMAR CANJE/);
  assert.match(valid, /Un solo uso/);
  assert.doesNotMatch(valid, /email|user_id/i);
  assert.doesNotMatch(validationPage(record, 'secret', 'redeemed'), /CONFIRMAR CANJE/);
});
