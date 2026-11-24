const db = require("../config/db");

// Copia en Postgres de las notas publicadas. Solo se usa cuando WordPress no responde bien.

async function upsert(client, posts) {
  await client.query(
    `INSERT INTO news_posts(id, data, published_at, fetched_at)
      SELECT (x->>'id')::int, x, (x->>'date')::timestamp, NOW() FROM jsonb_array_elements($1::jsonb) x
      ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data, published_at=EXCLUDED.published_at, fetched_at=NOW()`,
    [JSON.stringify(posts)]
  );
}

// `posts` es la página completa (con contentHtml) tal como llegó de WordPress, de la más nueva a la más vieja.
async function saveList(section, posts, { first = false, last = false } = {}) {
  if (!posts.length) return;
  const ids = posts.map((post) => post.id);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Una escritura a la vez: las páginas simultáneas no se bloquean entre sí.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('news-posts'))");
    await upsert(client, posts);
    await client.query(
      "INSERT INTO news_post_sections(section, post_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING",
      [section, ids]
    );
    // Lo que cae en este tramo de fechas y ya no vino fue retirado de la sección en WordPress.
    await client.query(
      `DELETE FROM news_post_sections s USING news_posts p WHERE p.id=s.post_id AND s.section=$1 AND NOT (p.id = ANY($2::int[]))
        AND ($3::boolean OR p.published_at < $4::timestamp) AND ($5::boolean OR p.published_at > $6::timestamp)`,
      [section, ids, first, posts[0].date, last, posts[posts.length - 1].date]
    );
    await client.query(
      `DELETE FROM news_posts p WHERE p.fetched_at < NOW()-INTERVAL '30 days'
        AND NOT EXISTS (SELECT 1 FROM news_post_sections s WHERE s.post_id=p.id)`
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function savePost(post) {
  await upsert(db, [post]);
}

async function removePost(id) {
  await db.query("DELETE FROM news_posts WHERE id=$1", [id]);
}

async function list(section, page, perPage) {
  const { rows } = await db.query(
    `SELECT p.data - 'contentHtml' AS data FROM news_post_sections s JOIN news_posts p ON p.id=s.post_id
      WHERE s.section=$1 ORDER BY p.published_at DESC, p.id DESC LIMIT $2 OFFSET $3`,
    [section, perPage, (page - 1) * perPage]
  );
  const { total } = (await db.query("SELECT COUNT(*)::int AS total FROM news_post_sections WHERE section=$1", [section])).rows[0];
  if (!total) return null;
  return { items: rows.map((row) => row.data), page, perPage, total, totalPages: Math.ceil(total / perPage) };
}

async function post(id) {
  return (await db.query("SELECT data FROM news_posts WHERE id=$1", [id])).rows[0]?.data ?? null;
}

module.exports = { saveList, savePost, removePost, list, post };
