const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTags, tagsForRecord } = require('../utils/experienceTags');
const service = require('../services/experiences.service');
const controller = require('../controllers/experiences.controller');

test('conserva categorías anteriores y elimina etiquetas duplicadas', () => {
  assert.deepEqual(tagsForRecord({ category: 'CITY DROP' }), ['CITY DROP']);
  assert.deepEqual(normalizeTags([' Museo ', 'Museo', 'MÚSICA', 'Música']), ['Museo', 'MÚSICA']);
});
test('API guarda y devuelve varias etiquetas, y rechaza datos inválidos', async () => {
  const original = service.create;
  const calls = [];
  service.create = async (data) => { calls.push(data); return { id: 'riseny', title: data.title, category: data.category, tags: data.tags }; };
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  try {
    const res = response();
    await controller.createExperience({ body: { title: 'RiseNY', tags: ['Museo', 'Experiencia inmersiva'] } }, res, (err) => { throw err; });
    assert.equal(res.code, 201);
    assert.deepEqual(calls[0].tags, ['Museo', 'Experiencia inmersiva']);
    assert.deepEqual(res.body.tags, ['Museo', 'Experiencia inmersiva']);
    for (const tags of ['Museo', [], [null], [''], ['x'.repeat(61)]]) {
      const invalid = response();
      await controller.createExperience({ body: { title: 'RiseNY', tags } }, invalid, (err) => { throw err; });
      assert.equal(invalid.code, 400);
    }
    assert.equal(calls.length, 1);
  } finally { service.create = original; }
});
