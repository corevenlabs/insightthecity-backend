const { test } = require('node:test');
const assert = require('node:assert/strict');
const stub = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let requests = [];
let responses = [];
let queries = [];
stub('../config/openai', { responses: { create: async (request) => { requests.push(request); return responses.shift(); } } });
stub('../config/db', { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } });
const experiences = require('../services/experiences.service');
const news = require('../services/news.service');
const users = require('../services/users.service');
const chat = require('../services/chat.service');
const controller = require('../controllers/chat.controller');

function reset() { requests = []; responses = []; queries = []; }
test('saludo conversa sin búsquedas obligatorias y recibe perfil y contexto previo', async () => {
  reset();
  responses.push({ id: 'hello', output: [], output_text: 'Hola, José, ¿cómo estás?' });
  const result = await chat.respond({ user: { name: 'José Pérez', language: 'es', is_premium: true }, history: [
    { role: 'user', message: 'Mi presupuesto son 80 dólares para dos.' },
    { role: 'assistant', message: 'Perfecto.' }, { role: 'user', message: 'Algo tranquilo' },
  ] });
  assert.equal(requests[0].tool_choice, 'auto');
  assert.match(requests[0].instructions, /incluye este nombre/);
  assert.match(requests[0].instructions, /José/);
  assert.match(requests[0].instructions, /membresía ITC Club activa/);
  assert.match(requests[0].input[0].content, /80 dólares/);
  assert.equal(result.reply, 'Hola, José, ¿cómo estás?');
  assert.deepEqual(result.appItems, []);
});
test('abrir chat limpia pantalla sin consultar ni borrar memoria del usuario', async () => {
  reset();
  const original = users.findById;
  users.findById = async (id) => ({ id, name: 'José', language: 'es' });
  try {
    let body;
    await controller.getChat({ user: { id: 7 } }, { json: (data) => { body = data; } }, (error) => { throw error; });
    assert.deepEqual(body.messages, []);
    assert.equal(body.greeting, null);
    assert.equal(queries.length, 0);
  } finally { users.findById = original; }
});
test('memoria se consulta por usuario y admite contexto anterior a los últimos 12 mensajes', async () => {
  reset();
  await chat.getHistory(42, 50);
  assert.deepEqual(queries[0].params, [42, 50]);
  assert.match(queries[0].sql, /WHERE user_id = \$1/);
  responses.push({ id: 'context', output: [], output_text: 'Mantengo ese presupuesto.' });
  await chat.respond({ user: {}, history: Array.from({ length: 30 }, (_, i) => ({ role: 'user', message: `Mensaje ${i}` })) });
  assert.equal(requests[0].input.length, 30);
});
test('buscar RiseNY encuentra registros fuera de los primeros 15 e incluye beneficios reales', async () => {
  reset();
  const originalList = experiences.list;
  const originalNews = news.listNews;
  experiences.list = async () => ({ rows: [
    ...Array.from({ length: 20 }, (_, i) => ({ id: String(i), title: 'Pizza', description: 'Restaurante' })),
    { id: 'rise', title: 'RiseNY', tags: ['Museo', 'Experiencia inmersiva'], access: 'premium', member_benefit: '20% OFF', member_benefit_details: 'Lunes a jueves' },
  ] });
  news.listNews = async () => ({ items: [] });
  responses.push({ id: 'search', output: [{ type: 'function_call', name: 'search_app_content', call_id: 'call1', arguments: '{"query":"RiseNY"}' }] }, { id: 'answer', output: [], output_text: 'RiseNY tiene 20% OFF de lunes a jueves.' });
  try {
    const result = await chat.respond({ user: {}, history: [{ role: 'user', message: 'Beneficio de RiseNY' }] });
    assert.equal(result.appItems.length, 1);
    assert.equal(result.appItems[0].id, 'rise');
    assert.equal(result.appItems[0].memberBenefitDetails, 'Lunes a jueves');
    const output = JSON.parse(requests[1].input[0].output);
    assert.equal(output.items[0].memberBenefit, '20% OFF');
  } finally { experiences.list = originalList; news.listNews = originalNews; }
});
test('fallo del catálogo permite responder sin inventar datos ni romper la conversación', async () => {
  reset();
  const originalList = experiences.list;
  const originalNews = news.listNews;
  experiences.list = news.listNews = async () => { throw new Error('offline'); };
  responses.push({ id: 'search', output: [{ type: 'function_call', name: 'search_app_content', call_id: 'call1', arguments: '{}' }] }, { id: 'answer', output: [], output_text: 'Ahora no puedo verificar el beneficio.' });
  try {
    const result = await chat.respond({ user: {}, history: [] });
    assert.match(JSON.parse(requests[1].input[0].output).error, /No inventes/);
    assert.deepEqual(result.appItems, []);
  } finally { experiences.list = originalList; news.listNews = originalNews; }
});

test('hola reconoce el perfil y nunca ofrece planes ni depende de la IA', async () => {
  reset();
  const result = await chat.respond({ user: { name: 'José Pérez', language: 'es' }, history: [{ role: 'user', message: 'hola' }] });
  assert.equal(result.reply, '¡Hola, José! ¿Cómo estás?');
  assert.deepEqual(result.appItems, []);
  assert.deepEqual(result.places, []);
  assert.equal(requests.length, 0);
});
test('saludo sin nombre pregunta cómo llamar al usuario sin inventar identidad', async () => {
  reset();
  const result = await chat.respond({ user: { name: null, language: 'es' }, history: [{ role: 'user', message: '¡Hola!' }] });
  assert.match(result.reply, /Cómo te gustaría que te llame/);
  assert.equal(requests.length, 0);
});

test('elimina enlaces escritos conservando el texto descriptivo', () => {
  assert.equal(chat.withoutLinks('Mira [RiseNY](https://riseny.co/tickets) y https://example.com.'), 'Mira RiseNY y');
  assert.equal(chat.withoutLinks('Visita www.example.com o example.org'), 'Visita o');
});
test('lugares externos solo se habilitan después de consultar ITC', async () => {
  reset();
  const originalList = experiences.list;
  const originalNews = news.listNews;
  experiences.list = async () => ({ rows: [] });
  news.listNews = async () => ({ items: [] });
  responses.push({ id: 'search', output: [{ type: 'function_call', name: 'search_app_content', call_id: 'call1', arguments: '{"query":"museo"}' }] }, { id: 'answer', output: [], output_text: 'No encontré una opción adecuada en ITC.' });
  try {
    await chat.respond({ user: {}, history: [{ role: 'user', message: 'Busco museos' }] });
    assert.deepEqual(requests[0].tools.map((tool) => tool.name), ['search_app_content']);
    assert.deepEqual(requests[1].tools.map((tool) => tool.name), ['search_app_content', 'search_places']);
  } finally { experiences.list = originalList; news.listNews = originalNews; }
});
