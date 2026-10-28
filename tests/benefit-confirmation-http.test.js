const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const security = require('../middleware/security-http');
const service = require('../services/benefits.service');
const controller = require('../controllers/benefits.controller');

test('QR page preserves same-origin form submission and CORS still rejects untrusted origins', async () => {
  const original = { find: service.find, redeem: service.redeem, state: service.state };
  let redeemed = false;
  service.find = async () => ({ title: 'Example', expires_at: new Date(Date.now() + 3600000).toISOString() });
  service.state = () => redeemed ? 'redeemed' : 'valid';
  // Igual que el UPDATE real: solo la primera petición canjea y recibe una fila.
  service.redeem = async () => { if (redeemed) return null; redeemed = true; return { redeemed_at: new Date() }; };
  const app = express();
  app.use(security.headers, security.cors);
  app.get('/benefit/:token', controller.showCode);
  app.post('/api/benefits/:token/redeem', controller.redeemCode);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/benefit/example`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'same-origin');
    assert.match(await page.text(), /CONFIRMAR CANJE/);
    for (const origin of ['null', 'https://untrusted.example']) {
      const blocked = await fetch(`${base}/api/benefits/example/redeem`, { method: 'POST', headers: { Origin: origin } });
      assert.equal(blocked.status, 403);
      assert.equal(redeemed, false);
    }
    const confirmed = await fetch(`${base}/api/benefits/example/redeem`, { method: 'POST', headers: { Origin: 'https://itc-backend-1031252664334.us-east1.run.app' } });
    assert.equal(confirmed.status, 200);
    const body = await confirmed.text();
    assert.match(body, /BENEFICIO CANJEADO/);
    assert.doesNotMatch(body, /CONFIRMAR CANJE/);
    assert.equal(redeemed, true);
    // Una segunda confirmación (doble envío o carrera) no muestra éxito.
    const second = await fetch(`${base}/api/benefits/example/redeem`, { method: 'POST', headers: { Origin: 'https://itc-backend-1031252664334.us-east1.run.app' } });
    const secondBody = await second.text();
    assert.match(secondBody, /CÓDIGO YA UTILIZADO/);
    assert.doesNotMatch(secondBody, /BENEFICIO CANJEADO/);
    // Volver a escanear un código ya canjeado tampoco parece un éxito.
    assert.match(await (await fetch(`${base}/benefit/example`)).text(), /CÓDIGO YA UTILIZADO/);
  } finally {
    Object.assign(service, original);
    await new Promise(resolve => server.close(resolve));
  }
});
