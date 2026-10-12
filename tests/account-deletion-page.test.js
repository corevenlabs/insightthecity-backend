const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const usersService = require('../services/users.service');
const controller = require('../controllers/account-deletion.controller');

function fakeRes() {
  return {
    statusCode: 200, body: '',
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    type() { return this; },
    send(body) { this.body = body; return this; },
  };
}

test('la página pública explica cómo eliminar la cuenta y ofrece el formulario', () => {
  const res = fakeRes();
  controller.page({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Perfil &gt; Eliminar cuenta/);
  assert.match(res.body, /<form method="post"/);
  const en = fakeRes();
  controller.page({ query: { lang: 'en' } }, en);
  assert.match(en.body, /Delete your ITC Club account/);
});

test('eliminar desde la web exige confirmación, valida la contraseña y limita intentos', async () => {
  const originalQuery = db.query;
  const originalRemove = usersService.remove;
  const hash = await bcrypt.hash('correcta123', 4);
  const removed = [];
  db.query = async () => ({ rows: [{ id: 42, password_hash: hash }] });
  usersService.remove = async (id) => { removed.push(id); return true; };
  controller._resetAttempts();
  try {
    const noConfirm = fakeRes();
    await controller.submit({ query: {}, ip: '1.1.1.1', body: { email: 'a@b.com', password: 'correcta123' } }, noConfirm);
    assert.equal(noConfirm.statusCode, 400);

    const wrong = fakeRes();
    await controller.submit({ query: {}, ip: '1.1.1.1', body: { email: 'a@b.com', password: 'mala', confirm: 'yes' } }, wrong);
    assert.equal(wrong.statusCode, 400);
    assert.equal(removed.length, 0);

    const ok = fakeRes();
    await controller.submit({ query: {}, ip: '1.1.1.1', body: { email: 'A@B.com ', password: 'correcta123', confirm: 'yes' } }, ok);
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(removed, [42]);
    assert.match(ok.body, /Solicitud de eliminación recibida/);

    for (let i = 0; i < 5; i += 1) {
      await controller.submit({ query: {}, ip: '2.2.2.2', body: { email: 'a@b.com', password: 'mala', confirm: 'yes' } }, fakeRes());
    }
    const limited = fakeRes();
    await controller.submit({ query: {}, ip: '2.2.2.2', body: { email: 'a@b.com', password: 'correcta123', confirm: 'yes' } }, limited);
    assert.equal(limited.statusCode, 429);
    assert.deepEqual(removed, [42]);
  } finally {
    db.query = originalQuery;
    usersService.remove = originalRemove;
    controller._resetAttempts();
  }
});
