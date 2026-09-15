const { test } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/experiences.service');
const controller = require('../controllers/experiences.controller');

function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
test('membresía exige un beneficio y rechaza texto inválido', async () => {
  for (const body of [
    { title: 'Membresía', access: 'premium' },
    { title: 'Membresía', access: 'premium', memberBenefit: '  ' },
    { title: 'Membresía', access: 'premium', memberBenefit: 20 },
    { title: 'Membresía', access: 'premium', memberBenefit: 'x'.repeat(201) },
    { title: 'Membresía', access: 'premium', memberBenefit: '20% OFF', memberBenefitDetails: 'x'.repeat(2001) },
  ]) {
    const res = response();
    await controller.createExperience({ body }, res, (error) => { throw error; });
    assert.equal(res.code, 400);
  }
});
test('guarda y devuelve descuento y condiciones independientes de Incluye', async () => {
  const original = service.create;
  let payload;
  service.create = async (data) => { payload = data; return { ...data, id: 'riseny', tags: ['Museo'], includes: data.includes }; };
  try {
    const res = response();
    await controller.createExperience({ body: { title: 'RiseNY', access: 'premium', tags: ['Museo'], memberBenefit: ' 20% de descuento ', memberBenefitDetails: ' Lunes a jueves ', includes: ['Entrada general'] } }, res, (error) => { throw error; });
    assert.equal(res.code, 201);
    assert.equal(payload.member_benefit, '20% de descuento');
    assert.equal(res.body.memberBenefit, '20% de descuento');
    assert.equal(res.body.memberBenefitDetails, 'Lunes a jueves');
    assert.deepEqual(res.body.includes, ['Entrada general']);
  } finally { service.create = original; }
});
test('ediciones de clientes anteriores conservan el beneficio al omitirlo', async () => {
  const original = service.update;
  let payload;
  service.update = async (id, data) => { payload = data; return { id, title: data.title, access: 'premium', member_benefit: '2x1', member_benefit_details: 'Con reserva' }; };
  try {
    const res = response();
    await controller.updateExperience({ params: { id: 'ejemplo' }, body: { title: 'Título actualizado', access: 'premium' } }, res, (error) => { throw error; });
    assert.equal(payload.member_benefit, undefined);
    assert.equal(payload.member_benefit_details, undefined);
    assert.equal(res.body.memberBenefit, '2x1');
    assert.equal(res.body.memberBenefitDetails, 'Con reserva');
  } finally { service.update = original; }
});

test('tarjetas exigen autorización explícita y un texto corto independiente', async () => {
  for (const body of [
    { showBenefitOnCard: 'true', cardBenefit: '20% OFF' },
    { showBenefitOnCard: true },
    { showBenefitOnCard: true, cardBenefit: 'x'.repeat(61) },
    { showBenefitOnCard: true, cardBenefit: '20% OFF\nCondiciones' },
  ]) {
    const res = response();
    await controller.createExperience({ body: { title: 'Ejemplo', ...body } }, res, (error) => { throw error; });
    assert.equal(res.code, 400);
  }
  const original = service.create;
  service.create = async (data) => ({ ...data, id: 'ejemplo', tags: ['Museo'], includes: ['Descripción completa'] });
  try {
    const hidden = response();
    await controller.createExperience({ body: { title: 'Snoopy', memberBenefit: 'Texto detallado' } }, hidden, (error) => { throw error; });
    assert.equal(hidden.body.showBenefitOnCard, false);
    assert.equal(hidden.body.cardBenefit, null);
    const visible = response();
    await controller.createExperience({ body: { title: 'Ejemplo', access: 'premium', memberBenefit: 'Descuento detallado', showBenefitOnCard: true, cardBenefit: ' 20% de descuento ' } }, visible, (error) => { throw error; });
    assert.equal(visible.code, 201);
    assert.equal(visible.body.showBenefitOnCard, true);
    assert.equal(visible.body.cardBenefit, '20% de descuento');
    assert.equal(visible.body.memberBenefit, 'Descuento detallado');
  } finally { service.create = original; }
});
