const db = require("../config/db");
const { slugify } = require("../utils/slugify");

// Columnas permitidas para ordenar (evita inyección en ORDER BY).
const SORTABLE = new Set([
  "id",
  "title",
  "category",
  "section",
  "access",
  "sort_order",
  "is_published",
  "is_featured",
  "created_at",
  "updated_at",
]);

const BASE_SELECT = `
  SELECT e.*,
    COALESCE(
      (SELECT json_agg(i.item ORDER BY i.sort_order, i.id)
         FROM experience_includes i
        WHERE i.experience_id = e.id),
      '[]'::json
    ) AS includes
  FROM experiences e
`;

async function replaceIncludes(client, experienceId, includes) {
  await client.query(`DELETE FROM experience_includes WHERE experience_id = $1`, [
    experienceId,
  ]);
  const items = Array.isArray(includes) ? includes.filter((x) => String(x).trim()) : [];
  for (let i = 0; i < items.length; i++) {
    await client.query(
      `INSERT INTO experience_includes (experience_id, item, sort_order) VALUES ($1, $2, $3)`,
      [experienceId, String(items[i]).trim(), i]
    );
  }
}

async function list({ section, publishedOnly, sort, order, start, end, filter } = {}) {
  const where = [];
  const params = [];

  if (publishedOnly) where.push(`e.is_published = TRUE`);
  if (section) {
    params.push(section);
    where.push(`e.section = $${params.length}`);
  }
  if (filter?.category) {
    params.push(filter.category);
    where.push(`e.category = $${params.length}`);
  }
  if (filter?.access) {
    params.push(filter.access);
    where.push(`e.access = $${params.length}`);
  }
  if (filter?.q) {
    params.push(`%${filter.q}%`);
    where.push(`(e.title ILIKE $${params.length} OR e.description ILIKE $${params.length})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRes = await db.query(
    `SELECT COUNT(*)::int AS total FROM experiences e ${whereSql}`,
    params
  );
  const total = totalRes.rows[0].total;

  const sortCol = SORTABLE.has(sort) ? sort : "sort_order";
  const sortDir = String(order).toUpperCase() === "DESC" ? "DESC" : "ASC";

  let sql = `${BASE_SELECT} ${whereSql} ORDER BY e.${sortCol} ${sortDir}, e.id ASC`;
  const pageParams = [...params];

  if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
    pageParams.push(end - start);
    sql += ` LIMIT $${pageParams.length}`;
    pageParams.push(start);
    sql += ` OFFSET $${pageParams.length}`;
  }

  const { rows } = await db.query(sql, pageParams);
  return { rows, total };
}

async function getById(id) {
  const { rows } = await db.query(`${BASE_SELECT} WHERE e.id = $1`, [id]);
  return rows[0] || null;
}

async function create(data) {
  const id = (data.id && slugify(data.id)) || slugify(data.title);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO experiences
        (id, title, category, image_url, date_label, location, access,
        description, recommendation, section, is_featured, sort_order, is_published, ends_at,
        is_paid_event, ticket_url, ticket_cta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        id,
        data.title,
        data.category,
        data.image_url ?? null,
        data.date_label ?? null,
        data.location ?? null,
        data.access === "premium" ? "premium" : "free",
        data.description ?? null,
        data.recommendation ?? null,
        data.section ?? null,
        Boolean(data.is_featured),
        Number.isFinite(data.sort_order) ? data.sort_order : 0,
        data.is_published === undefined ? true : Boolean(data.is_published),
        data.ends_at ?? null,
        Boolean(data.is_paid_event),
        data.is_paid_event ? data.ticket_url ?? null : null,
        data.is_paid_event ? data.ticket_cta || "COMPRAR ENTRADAS" : null,
      ]
    );
    await replaceIncludes(client, id, data.includes);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return getById(id);
}

async function update(id, data) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE experiences SET
         title = COALESCE($2, title),
         category = COALESCE($3, category),
         image_url = $4,
         date_label = $5,
         location = $6,
         access = COALESCE($7, access),
         description = $8,
         recommendation = $9,
         section = $10,
         is_featured = COALESCE($11, is_featured),
         sort_order = COALESCE($12, sort_order),
         is_published = COALESCE($13, is_published),
         ends_at = $14,
         is_paid_event = COALESCE($15, is_paid_event),
         ticket_url = $16,
         ticket_cta = $17
       WHERE id = $1`,
      [
        id,
        data.title ?? null,
        data.category ?? null,
        data.image_url ?? null,
        data.date_label ?? null,
        data.location ?? null,
        data.access === undefined ? null : data.access === "premium" ? "premium" : "free",
        data.description ?? null,
        data.recommendation ?? null,
        data.section ?? null,
        data.is_featured === undefined ? null : Boolean(data.is_featured),
        Number.isFinite(data.sort_order) ? data.sort_order : null,
        data.is_published === undefined ? null : Boolean(data.is_published),
        data.ends_at ?? null,
        data.is_paid_event === undefined ? null : Boolean(data.is_paid_event),
        data.is_paid_event ? data.ticket_url ?? null : null,
        data.is_paid_event ? data.ticket_cta || "COMPRAR ENTRADAS" : null,
      ]
    );
    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    if (data.includes !== undefined) {
      await replaceIncludes(client, id, data.includes);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return getById(id);
}

async function remove(id) {
  const { rowCount } = await db.query(`DELETE FROM experiences WHERE id = $1`, [id]);
  return rowCount > 0;
}

module.exports = { list, getById, create, update, remove };
