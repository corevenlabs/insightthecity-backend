const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../middleware/manejadorErrores');

function run(err, req = {}) {
  const lines = [];
  const original = console.error;
  console.error = line => lines.push(line);
  const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const request = { method: 'PUT', originalUrl: '/api/partners/clients/abc/experience?token=secret', baseUrl: '/api/partners', route: { path: '/clients/:id/experience' }, get: name => name === 'x-cloud-trace-context' ? '0123456789abcdef0123456789abcdef/1;o=1' : undefined, admin: { id: 7, email: 'staff@example.com' }, body: { description: 'private text' }, ...req };
  process.env.GCS_PROJECT_ID = 'demo-project';
  try { handler(err, request, res, () => {}); } finally { console.error = original; }
  return { res, entries: lines.map(line => JSON.parse(line)) };
}

test('unexpected errors are logged as structured Error Reporting events without private request data', () => {
  const { res, entries } = run(Object.assign(new Error('relation "x" does not exist'), { code: '42P01', table: 'x' }));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'No se pudo completar la operación');
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.severity, 'ERROR');
  assert.equal(entry['@type'], 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent');
  assert.match(entry.message, /^PUT \/api\/partners\/clients\/:id\/experience -> 500: relation "x" does not exist\n/);
  assert.match(entry.message, /at /);
  assert.equal(entry.path, '/api/partners/clients/abc/experience');
  assert.equal(entry.code, '42P01');
  assert.equal(entry.adminId, 7);
  assert.equal(entry['logging.googleapis.com/trace'], 'projects/demo-project/traces/0123456789abcdef0123456789abcdef');
  const text = JSON.stringify(entry);
  for (const secret of ['token=secret', 'private text', 'staff@example.com']) assert.ok(!text.includes(secret), secret);
});

test('database text errors answered as 400 keep the original cause as a warning', () => {
  const { res, entries } = run(Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: '22021' }));
  assert.equal(res.statusCode, 400);
  assert.equal(entries[0].severity, 'WARNING');
  assert.equal(entries[0].code, '22021');
  assert.match(entries[0].message, /-> 400: invalid byte sequence/);
  assert.equal(entries[0]['@type'], undefined);
});

test('expected client errors are not logged', () => {
  const { res, entries } = run(Object.assign(new Error('Agrega un título'), { status: 400 }));
  assert.equal(res.statusCode, 400);
  assert.equal(entries.length, 0);
});
