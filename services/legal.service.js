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
async function getCurrent(slug, language = "es") {
  const { rows } = await db.query(
    `SELECT * FROM legal_documents
     WHERE slug = $1 AND language = ANY($2::text[]) AND published_at IS NOT NULL
     ORDER BY (language = $3) DESC, published_at DESC
     LIMIT 1`,
    [slug, [language, "es"], language]
  );
  return serialize(rows[0]);
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
       (SELECT COALESCE(MAX(version), 0) + 1 FROM legal_documents WHERE slug = $1 AND language = $2),
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
async function recordAcceptance(client, { userId, language, context, slugs }) {
  const runner = client || db;
  for (const slug of slugs) {
    const doc = await getCurrent(slug, language);
    if (!doc) console.warn(`[legal] ${slug} no tiene versión publicada; se registra la aceptación sin versión.`);
    await runner.query(
      `INSERT INTO legal_acceptances (user_id, document_id, slug, version, context)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, doc?.id ?? null, slug, doc?.version ?? null, context]
    );
  }
}

module.exports = {
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
