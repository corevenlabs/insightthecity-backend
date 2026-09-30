const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMoney } = require('../services/guides.service');

test('las guías nuevas usan US$1 por defecto', () => {
  assert.deepEqual(normalizeMoney({}), { priceCents: 100, currency: 'usd' });
});

test('normaliza la moneda configurada por el administrador', () => {
  assert.deepEqual(normalizeMoney({ priceCents: 2500, currency: ' USD ' }), { priceCents: 2500, currency: 'usd' });
});

test('rechaza precios inválidos', () => {
  assert.throws(() => normalizeMoney({ priceCents: 49 }), /mayor o igual a 50/);
  assert.throws(() => normalizeMoney({ priceCents: 100.5 }), /número entero/);
});
