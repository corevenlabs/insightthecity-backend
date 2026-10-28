const db = require("../config/db");

// Documentos legales versionados. Una versión publicada no se edita nunca:
// cambiar un texto vigente crea un borrador nuevo que el admin publica.

const SLUGS = ["terms", "privacy", "subscription", "accessibility"];
const LANGUAGES = ["es", "en", "pt"];
// Lo que el usuario acepta al crear la cuenta / al suscribirse.
const REGISTER_SLUGS = ["terms", "privacy"];
const SUBSCRIPTION_SLUGS = ["subscription"];

function serialize(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: row.slug,
    language: row.language,
    version: row.version,
    title: row.title,
    content: row.content,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Versión vigente en el idioma pedido; si no existe, cae al español.
async function getCurrent(slug, language = "es", { cacheOnly = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM legal_documents
     WHERE slug = $1 AND language = ANY($2::text[]) AND published_at IS NOT NULL
     ORDER BY (language = $3) DESC, published_at DESC
     LIMIT 1`,
    [slug, [language, "es"], language]
  );
  const document = serialize(rows[0]);
  if (!document || document.language === language || !['en', 'pt'].includes(language)) return document;
  // A reading translation of the current published source, never a rewrite or a new legal version.
  // The same object is used by recordAcceptance, so the evidence snapshot matches the displayed text.
  const translation = require('./content-language.service');
  const title = await translation.translateText(document.title, language, false, cacheOnly);
  const content = await translation.translateText(document.content, language, false, cacheOnly);
  if (title === null || content === null) return document;
  return {
    ...document,
    language,
    sourceLanguage: document.language,
    sourceDocumentId: document.id,
    sourceVersion: document.version,
    sourceContentHash: require('node:crypto').createHash('sha256').update(document.content).digest('hex'),
    isTranslated: true,
    title,
    content,
  };
}

async function listAll() {
  const { rows } = await db.query(
    `SELECT * FROM legal_documents ORDER BY slug, language, version DESC`
  );
  return rows.map(serialize);
}

async function get(id) {
  const { rows } = await db.query(`SELECT * FROM legal_documents WHERE id = $1`, [id]);
  return serialize(rows[0]);
}

// Crea un borrador con el siguiente número de versión para slug + idioma.
async function createDraft({ slug, language, title, content }) {
  const { rows } = await db.query(
    `INSERT INTO legal_documents (slug, language, version, title, content)
     VALUES ($1, $2,
       (SELECT COALESCE(MAX(version), 0) + 1 FROM legal_documents WHERE slug = $1::varchar AND language = $2::varchar),
       $3, $4)
     RETURNING *`,
    [slug, language, title, content]
  );
  return serialize(rows[0]);
}

// Solo los borradores son editables. Devuelve null si no existe o ya se publicó.
async function updateDraft(id, { title, content }) {
  const { rows } = await db.query(
    `UPDATE legal_documents
     SET title = COALESCE($2, title), content = COALESCE($3, content), updated_at = NOW()
     WHERE id = $1 AND published_at IS NULL
     RETURNING *`,
    [id, title ?? null, content ?? null]
  );
  return serialize(rows[0]);
}

async function publish(id) {
  const { rows } = await db.query(
    `UPDATE legal_documents SET published_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND published_at IS NULL
     RETURNING *`,
    [id]
  );
  return serialize(rows[0]);
}

async function removeDraft(id) {
  const { rowCount } = await db.query(
    `DELETE FROM legal_documents WHERE id = $1 AND published_at IS NULL`,
    [id]
  );
  return rowCount > 0;
}

// Registra que el usuario aceptó las versiones vigentes de los documentos indicados.
async function recordAcceptance(client, { userId, language, context, slugs, renewal = null, customerReference = null }) {
  const runner = client || db;
  for (const slug of slugs) {
    const doc = await getCurrent(slug, language, { cacheOnly: true }); // Never call a translation provider inside registration/payment transactions.
    if (!doc) console.warn(`[legal] ${slug} no tiene versión publicada; se registra la aceptación sin versión.`);
    await runner.query(
      `INSERT INTO legal_acceptances (user_id, document_id, slug, version, context, user_reference, document_snapshot, renewal_snapshot, customer_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, doc?.id ?? null, slug, doc?.version ?? null, context, `ITC-U-${userId}`, doc ? JSON.stringify(doc) : null, renewal ? JSON.stringify(renewal) : null, customerReference]
    );
  }
}

async function listAcceptances({ search = '', slug = '', context = '', page = 1 }) {
  const values = [search, slug, context];
  const where = `WHERE ($1 = '' OR u.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%' OR u.id::text = $1 OR a.user_reference ILIKE '%' || $1 || '%' OR a.customer_reference = $1)
    AND ($2 = '' OR a.slug = $2) AND ($3 = '' OR a.context = $3)`;
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM legal_acceptances a LEFT JOIN users u ON u.id = a.user_id ${where}`, values);
  const { rows } = await db.query(`SELECT a.id, a.user_id AS "userId", u.name AS "userName", u.email AS "userEmail",
    a.slug, a.version, a.context, a.accepted_at AS "acceptedAt", a.document_id AS "documentId",
    COALESCE(a.document_snapshot->>'title',d.title) AS "documentTitle", COALESCE(a.document_snapshot->>'language',d.language) AS language,
    a.user_reference AS "userReference", a.customer_reference AS "customerReference", a.account_deleted_at AS "accountDeletedAt", a.document_snapshot AS "documentSnapshot", a.renewal_snapshot AS "renewalSnapshot"
    FROM legal_acceptances a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN legal_documents d ON d.id = a.document_id
    ${where} ORDER BY a.accepted_at DESC, a.id DESC LIMIT 25 OFFSET $4`, [...values, (page - 1) * 25]);
  return { items: rows, total: count.rows[0].total, page, pageSize: 25 };
}

async function acceptance(id) {
  return (await db.query('SELECT * FROM legal_acceptances WHERE id=$1', [id])).rows[0] || null;
}

module.exports = {
  acceptance,
  listAcceptances,
  SLUGS,
  LANGUAGES,
  REGISTER_SLUGS,
  SUBSCRIPTION_SLUGS,
  getCurrent,
  listAll,
  get,
  createDraft,
  updateDraft,
  publish,
  removeDraft,
  recordAcceptance,
};
