const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreV1 } = require('../scripts/restore-partner-terms-v1');
const docs = ['founding', 'strategic'].map(variant => ({ variant, language: 'en', title: `${variant} v2`, content: 'approved imported text' }));
function fixture(change) {
  const statements = [];
  const rows = Object.fromEntries(docs.map(doc => [doc.variant, [
    { id: `${doc.variant}-1`, version: 1, approved_at: '2026-10-12' },
    { id: `${doc.variant}-2`, version: 2, approved_at: '2026-10-12', title: doc.title, content: doc.content },
  ]]));
  change?.(rows);
  const client = { query: async (sql, params) => {
    statements.push({ sql, params });
    if (sql.startsWith('SELECT id,version')) return { rows: rows[params[0]] };
    if (sql.includes('AS invitations')) return { rows: [{ invitations: 2, acceptances: 1 }] };
    return { rows: [] };
  }};
  return { client, statements };
}
test('retira solo las v2 importadas y conserva expedientes y aceptaciones', async () => {
  const { client, statements } = fixture();
  assert.equal(await restoreV1(client, docs), 2);
  assert.deepEqual(statements.filter(x => x.sql.startsWith('DELETE')).map(x => x.params[0]), ['founding-2', 'strategic-2']);
  assert.equal(statements.some(x => /^(UPDATE|DELETE FROM) partner_(clients|acceptances)/.test(x.sql)), false);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});
test('si una v1 no está aprobada, aborta ambas eliminaciones', async () => {
  const { client, statements } = fixture(rows => { rows.strategic[0].approved_at = null; });
  await assert.rejects(restoreV1(client, docs), /falta la v1/);
  assert.equal(statements.some(x => x.sql.startsWith('DELETE')), false);
  assert.equal(statements.at(-1).sql, 'ROLLBACK');
});
test('no elimina versiones distintas de las importadas', async () => {
  const { client, statements } = fixture(rows => { rows.strategic[1].content = 'other approved contract'; });
  await assert.rejects(restoreV1(client, docs), /versión distinta/);
  assert.equal(statements.some(x => x.sql.startsWith('DELETE')), false);
});
test('puede ejecutarse nuevamente sin recrear documentos', async () => {
  const { client, statements } = fixture(rows => { for (const key of Object.keys(rows)) rows[key].pop(); });
  assert.equal(await restoreV1(client, docs), 0);
  assert.equal(statements.some(x => /^(DELETE|INSERT INTO partner_terms\()/.test(x.sql)), false);
});

test('una restauración ya registrada no impide futuras versiones aprobadas', async () => {
  const statements = [];
  const client = { query: async sql => {
    statements.push(sql);
    return { rows: sql.startsWith('SELECT migration_key') ? [{ migration_key: 'applied' }] : [] };
  }};
  assert.equal(await restoreV1(client, docs), 0);
  assert.equal(statements.some(sql => sql.startsWith('SELECT id,version') || sql.startsWith('DELETE')), false);
});
