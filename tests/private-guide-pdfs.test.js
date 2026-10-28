const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Carga uploads.service con el driver gcs y un storage falso que registra el bucket usado.
function loadUploads(env) {
  const used = [];
  const storagePath = require.resolve('../config/storage');
  const uploadsPath = require.resolve('../services/uploads.service');
  const saved = { UPLOAD_DRIVER: process.env.UPLOAD_DRIVER, GCS_BUCKET: process.env.GCS_BUCKET, GCS_PRIVATE_BUCKET: process.env.GCS_PRIVATE_BUCKET };
  Object.assign(process.env, { UPLOAD_DRIVER: 'gcs', GCS_BUCKET: 'public-media' });
  if (env.GCS_PRIVATE_BUCKET === undefined) delete process.env.GCS_PRIVATE_BUCKET;
  else process.env.GCS_PRIVATE_BUCKET = env.GCS_PRIVATE_BUCKET;
  require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: {
    bucket: (name) => ({ file: () => ({ save: async () => used.push(name), createReadStream: () => { used.push(name); return { pipe() {}, on() {} }; } }) }),
  } };
  delete require.cache[uploadsPath];
  const uploads = require(uploadsPath);
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v;
    delete require.cache[storagePath];
    delete require.cache[uploadsPath];
  };
  return { uploads, used, restore };
}

const pdf = { buffer: Buffer.from('%PDF-1.4 test'), mimetype: 'application/pdf', originalname: 'guia.pdf', size: 13 };

test('los PDFs de guías se suben y leen solo del bucket privado', async () => {
  const { uploads, used, restore } = loadUploads({ GCS_PRIVATE_BUCKET: 'private-guides' });
  try {
    const saved = await uploads.uploadPrivatePdf(pdf);
    assert.match(saved.key, /^guides\//);
    uploads.streamPrivatePdf(saved.key, {});
    assert.deepEqual(used, ['private-guides', 'private-guides']);
  } finally { restore(); }
});

test('sin bucket privado, o si es el público, no se sube ni se lee ningún PDF', async () => {
  for (const value of [undefined, 'public-media']) {
    const { uploads, used, restore } = loadUploads({ GCS_PRIVATE_BUCKET: value });
    try {
      await assert.rejects(uploads.uploadPrivatePdf(pdf), /GCS_PRIVATE_BUCKET/);
      assert.throws(() => uploads.streamPrivatePdf('guides/x.pdf', {}), /GCS_PRIVATE_BUCKET/);
      assert.deepEqual(used, []);
    } finally { restore(); }
  }
});

test('confirmar la compra no devuelve pdfKey al comprador', async () => {
  const service = require('../services/guides.service');
  const stripe = require('../services/stripe.service');
  const controller = require(path.join('..', 'controllers', 'guides.controller'));
  const original = { record: service.recordPurchase, retrieve: stripe.retrieveCheckoutSession };
  service.recordPurchase = async () => ({ id: 5, title: 'Guía', pdfKey: 'guides/secret.pdf', pdfName: 'guia.pdf' });
  stripe.retrieveCheckoutSession = async () => ({ id: 'cs_1', mode: 'payment', payment_status: 'paid', status: 'complete', metadata: { purchase_type: 'guide', guide_id: '5', user_id: '7' }, amount_total: 500, currency: 'usd' });
  let body;
  try {
    await controller.confirmPurchase({ params: { id: '5' }, body: { sessionId: 'cs_1' }, query: {}, user: { id: 7 } }, { json: (b) => { body = b; }, status() { return this; } }, (e) => { throw e; });
    assert.equal(body.success, true);
    assert.equal(body.guide.id, 5);
    assert.equal('pdfKey' in body.guide, false);
  } finally {
    service.recordPurchase = original.record;
    stripe.retrieveCheckoutSession = original.retrieve;
  }
});
