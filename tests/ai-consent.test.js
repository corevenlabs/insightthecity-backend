const { test } = require('node:test');
const assert = require('node:assert/strict');
const stub = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let queries = [];
let user = null;
let openAiCalls = 0;
const client = {
  query: async (sql, params) => {
    queries.push({ sql, params });
    if (/^UPDATE users/.test(sql)) {
      user = { ...user, ai_consent_version: /ai_consent_version = \$2/.test(sql) ? params[1] : null, ai_consent_at: /NOW\(\)/.test(sql) ? new Date() : null };
      return { rows: [user] };
    }
    return { rows: [] };
  },
  release() {},
};
stub('../config/db', { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [{ id: 1 }] }; }, connect: async () => client });
stub('../config/openai', { responses: { create: async () => { openAiCalls += 1; return { id: 'r', output: [], output_text: 'Hola' }; } } });
const usersService = require('../services/users.service');
const aiConsent = require('../services/ai-consent.service');
const controller = require('../controllers/chat.controller');

function fakeRes() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function reset(initial) {
  queries = []; openAiCalls = 0;
  user = { id: 7, name: 'Ana', language: 'en', ai_consent_version: null, ai_consent_at: null, ...initial };
  usersService.findById = async () => user;
}

test('el aviso existe en los tres idiomas y nombra a OpenAI y la retención', () => {
  for (const lang of ['es', 'en', 'pt']) {
    const notice = aiConsent.notice(lang);
    assert.match(notice.title, /OpenAI/);
    assert.match(notice.retention, /30/);
    assert.equal(notice.points.length, 3);
  }
});

test('sin permiso el chat no guarda ni envía nada a OpenAI', async () => {
  reset();
  const res = fakeRes();
  await controller.enviarMensaje({ user: { id: 7 }, body: { message: 'Planes en Brooklyn' } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'AI_CONSENT_REQUIRED');
  assert.equal(res.body.aiConsent.accepted, false);
  assert.equal(res.body.aiConsent.language, 'en');
  assert.equal(queries.length, 0);
  assert.equal(openAiCalls, 0);
});

test('GET del chat informa si falta el permiso y con qué texto', async () => {
  reset();
  const res = fakeRes();
  await controller.getChat({ user: { id: 7 } }, res, (e) => { throw e; });
  assert.equal(res.body.aiConsent.accepted, false);
  assert.equal(res.body.aiConsent.version, aiConsent.VERSION);
  assert.match(res.body.aiConsent.notice.title, /OpenAI/);
});

test('aceptar exige la versión vigente y guarda evidencia con el texto mostrado', async () => {
  reset();
  const outdated = fakeRes();
  await controller.grantConsent({ user: { id: 7 }, body: { version: aiConsent.VERSION + 1 } }, outdated, (e) => { throw e; });
  assert.equal(outdated.statusCode, 409);
  assert.equal(queries.length, 0);

  const ok = fakeRes();
  await controller.grantConsent({ user: { id: 7 }, body: { version: aiConsent.VERSION } }, ok, (e) => { throw e; });
  assert.equal(ok.body.aiConsent.accepted, true);
  const event = queries.find((q) => /INSERT INTO ai_consent_events/.test(q.sql));
  assert.deepEqual(event.params.slice(0, 5), [7, 'ITC-U-7', 'granted', aiConsent.VERSION, 'en']);
  assert.match(JSON.parse(event.params[5]).title, /OpenAI artificial intelligence/);
  assert.equal(usersService.publicUser(user).ai_chat_consent, true);
});

test('con permiso el chat responde; al retirarlo vuelve a bloquearse', async () => {
  reset({ ai_consent_version: aiConsent.VERSION, ai_consent_at: new Date() });
  const sent = fakeRes();
  await controller.enviarMensaje({ user: { id: 7 }, body: { message: 'hola' } }, sent, (e) => { throw e; });
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.body.success, true);

  const revoked = fakeRes();
  await controller.revokeConsent({ user: { id: 7 } }, revoked, (e) => { throw e; });
  assert.equal(revoked.body.aiConsent.accepted, false);
  assert.ok(queries.some((q) => /INSERT INTO ai_consent_events/.test(q.sql) && q.params[2] === 'revoked'));
  const blocked = fakeRes();
  await controller.enviarMensaje({ user: { id: 7 }, body: { message: 'hola' } }, blocked, (e) => { throw e; });
  assert.equal(blocked.statusCode, 403);
});
