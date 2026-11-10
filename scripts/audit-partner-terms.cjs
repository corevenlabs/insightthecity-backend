// Read-only evidence lookup. Never records acceptance, sends mail or changes clients.
const { Client } = require('pg');
const fs = require('node:fs');
async function audit() {
  const business = (process.env.AUDIT_BUSINESS_NAME || '').trim();
  if (!business || business.length > 120) throw new Error('INVALID_BUSINESS_FILTER');
  const db = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, ssl: false, connectionTimeoutMillis: 15000, statement_timeout: 10000 });
  await db.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const clients = (await db.query(`SELECT p.id,p.business_name,p.email,p.form_status,p.deleted_at,p.experience_id,e.title AS experience_title FROM partner_clients p LEFT JOIN experiences e ON e.id=p.experience_id WHERE p.business_name ILIKE $1 ORDER BY p.deleted_at NULLS FIRST,p.created_at LIMIT 10`, ['%' + business.replace(/[\\%_]/g, '\\$&') + '%'])).rows;
    const results = [];
    for (const client of clients) {
      const acceptances = (await db.query(`SELECT id,stage,language,signer_name,signer_email,accepted_at,material_authorized,submission_version,document->>'id' AS document_id,document->>'title' AS document_title,document->>'version' AS document_version FROM partner_acceptances WHERE client_id=$1 ORDER BY accepted_at`, [client.id])).rows;
      results.push({ client, acceptances });
    }
    await db.query('COMMIT');
    const result = { checkedAt: new Date().toISOString(), readOnly: true, filter: business, results };
    const encoded = JSON.stringify(result, null, 2);
    if (process.env.AUDIT_RESULT_PATH) fs.writeFileSync(process.env.AUDIT_RESULT_PATH, encoded + '\n', { mode: 0o600 });
    console.log('AUDIT_RESULT=' + JSON.stringify(result));
  } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
  finally { await db.end(); }
}
audit().catch(error => { console.error('PARTNER_TERMS_AUDIT_FAILED', error.code || error.message); process.exitCode = 1; });
