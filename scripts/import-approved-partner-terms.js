require('dotenv').config();
const db = require('../config/db');
const documents = require('../database/partner-terms/approved-en-2026-10-12.2.json');
// Importación administrativa aprobada; conserva versiones y acuerdos anteriores.
(async () => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(731923)');
    const { rows: admins } = await client.query("SELECT id FROM admins WHERE role='admin' AND is_active=true ORDER BY id LIMIT 1");
    if (!admins.length) throw new Error('Se requiere un administrador activo para registrar la importación.');
    for (const doc of documents) {
      const existing = await client.query('SELECT id FROM partner_terms WHERE variant=$1 AND language=$2 AND title=$3 AND content=$4 AND approved_at IS NOT NULL', [doc.variant,doc.language,doc.title,doc.content]);
      if (existing.rows.length) { console.log(`${doc.variant}: versión aprobada ya disponible`); continue; }
      await client.query(`INSERT INTO partner_terms(variant,language,version,title,content,approved_at,created_by)
        SELECT $1,$2,COALESCE(MAX(version),0)+1,$3,$4,NOW(),$5 FROM partner_terms WHERE variant=$1 AND language=$2`,
        [doc.variant,doc.language,doc.title,doc.content,admins[0].id]);
      console.log(`${doc.variant}: documento inglés aprobado importado mediante despliegue; administrador de registro ${admins[0].id}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK'); console.error(error.message); process.exitCode=1;
  } finally { client.release(); await db.end(); }
})();
