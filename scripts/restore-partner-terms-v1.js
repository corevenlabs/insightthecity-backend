const imported = require('../database/partner-terms/approved-en-2026-10-12.2.json');

// Retira exclusivamente las dos v2 importadas, sin editar contratos enviados/aceptados.
async function restoreV1(client, documents = imported) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(731923)');
    await client.query(`CREATE TABLE IF NOT EXISTS partner_terms_retirements (
      migration_key TEXT PRIMARY KEY, retired_ids JSONB NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const key = 'restore-v1-remove-imported-en-2026-10-12.2';
    const applied = await client.query('SELECT migration_key FROM partner_terms_retirements WHERE migration_key=$1', [key]);
    if (applied.rows.length) { await client.query('COMMIT'); return 0; }
    const targets = [];
    for (const doc of documents) {
      const { rows } = await client.query(
        'SELECT id,version,title,content,approved_at FROM partner_terms WHERE variant=$1 AND language=$2 ORDER BY version FOR UPDATE',
        [doc.variant, doc.language],
      );
      const original = rows.find(row => row.version === 1 && row.approved_at);
      if (!original) throw new Error(`${doc.variant}: falta la v1 aprobada; no se retiró ningún documento.`);
      const newer = rows.filter(row => row.version > 1);
      if (newer.some(row => row.version !== 2 || row.title !== doc.title || row.content !== doc.content)) {
        throw new Error(`${doc.variant}: existe una versión distinta de la importada; se requiere revisión.`);
      }
      targets.push(...newer.map(row => ({ id: row.id, variant: doc.variant })));
    }
    for (const target of targets) {
      const { rows } = await client.query(
        `SELECT
          (SELECT COUNT(*)::int FROM partner_clients WHERE terms_snapshot @> $1::jsonb) AS invitations,
          (SELECT COUNT(*)::int FROM partner_acceptances WHERE document->>'id'=$2) AS acceptances`,
        [JSON.stringify({ en: { id: target.id } }), target.id],
      );
      await client.query('DELETE FROM partner_terms WHERE id=$1 AND version=2', [target.id]);
      console.log(`${target.variant}: v2 retirada; v1 vigente. Copias conservadas: ${rows[0].invitations} expedientes y ${rows[0].acceptances} aceptaciones.`);
    }
    await client.query('INSERT INTO partner_terms_retirements(migration_key,retired_ids) VALUES($1,$2::jsonb)', [key, JSON.stringify(targets)]);
    await client.query('COMMIT');
    return targets.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
module.exports = { restoreV1 };
if (require.main === module) {
  require('dotenv').config();
  const db = require('../config/db');
  (async () => {
    const client = await db.connect();
    try {
      const count = await restoreV1(client);
      console.log(`Términos verificados: ${count} versiones importadas retiradas en esta ejecución.`);
    } finally { client.release(); await db.end(); }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
