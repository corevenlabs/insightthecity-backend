const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const legal = require("./legal.service");
const stripeService = require("./stripe.service");
const { deletePrefix } = require("./uploads.service");

// Auth de usuarios de la app (distinto de los admins del panel).
// La tabla `users` guarda name, email, password_hash, is_premium, is_active.

const PUBLIC_FIELDS = `id, name, email, is_premium, is_active, language, created_at, avatar_url, home_area, interests,
  subscription_status, subscription_current_period_end, subscription_cancel_at_period_end,
  subscription_amount_cents, subscription_currency, subscription_interval,
  (stripe_customer_id IS NOT NULL) AS has_billing_account`;

// Fila completa -> datos que puede ver el propio usuario (sin hashes ni ids de Stripe).
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    is_premium: row.is_premium,
    is_active: row.is_active,
    language: row.language || "es",
    created_at: row.created_at,
    avatar_url: row.avatar_url ?? null,
    home_area: row.home_area ?? "",
    interests: row.interests ?? [],
    subscription_status: row.subscription_status ?? null,
    subscription_current_period_end: row.subscription_current_period_end ?? null,
    subscription_cancel_at_period_end: row.subscription_cancel_at_period_end === true,
    subscription_amount_cents: row.subscription_amount_cents ?? null,
    subscription_currency: row.subscription_currency ?? null,
    subscription_interval: row.subscription_interval ?? null,
    has_billing_account: row.has_billing_account ?? Boolean(row.stripe_customer_id),
  };
}

// Columnas por las que el panel puede ordenar (whitelist anti-inyección).
const SORTABLE = new Set(["id", "name", "email", "is_premium", "is_active", "created_at"]);

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, type: "user" },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

async function findByEmail(email) {
  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [email]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Crea una cuenta y registra la aceptación de Términos y Privacidad vigentes.
// Devuelve { token, user } o lanza { status, message }.
async function register({ name, email, password, language = "es" }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const password_hash = await bcrypt.hash(password, 10);

  const existing = await findByEmail(normalizedEmail);
  if (existing) {
    const err = new Error("Ya existe una cuenta con ese correo");
    err.status = 409;
    throw err;
  }

  const client = await db.connect();
  let user;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, language)
       VALUES ($1, $2, $3, $4)
       RETURNING ${PUBLIC_FIELDS}`,
      [name ? String(name).trim() : null, normalizedEmail, password_hash, language]
    );
    user = rows[0];
    await legal.recordAcceptance(client, {
      userId: user.id, language, context: "register", slugs: legal.REGISTER_SLUGS,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { token: signToken(user), user: publicUser(user) };
}

// Verifica credenciales. Devuelve { token, user }, null si no coinciden,
// o lanza 403 si la cuenta está desactivada.
async function login(email, password) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await findByEmail(normalizedEmail);
  if (!user || !user.password_hash) return null;

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;

  if (user.is_active === false) {
    const err = new Error("Tu cuenta está desactivada. Contacta con soporte.");
    err.status = 403;
    throw err;
  }

  return { token: signToken(user), user: publicUser(user) };
}

// ---- Administración (panel) ----

// Lista paginada estilo react-admin (_start/_end/_sort/_order + filtros).
async function listForAdmin({ sort, order, start, end, filter = {} } = {}) {
  const where = [];
  const values = [];

  if (filter.q) {
    values.push(`%${filter.q.toLowerCase()}%`);
    where.push(`(LOWER(name) LIKE $${values.length} OR LOWER(email) LIKE $${values.length})`);
  }
  if (filter.premium === "true" || filter.premium === "false") {
    values.push(filter.premium === "true");
    where.push(`is_premium = $${values.length}`);
  }
  if (filter.active === "true" || filter.active === "false") {
    values.push(filter.active === "true");
    where.push(`is_active = $${values.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRes = await db.query(`SELECT COUNT(*)::int AS total FROM users ${whereSql}`, values);
  const total = totalRes.rows[0].total;

  const sortCol = SORTABLE.has(sort) ? sort : "created_at";
  const sortDir = String(order).toUpperCase() === "ASC" ? "ASC" : "DESC";

  let limitSql = "";
  const pageValues = [...values];
  if (start !== undefined && end !== undefined) {
    pageValues.push(end - start); // LIMIT
    pageValues.push(start); // OFFSET
    limitSql = `LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`;
  }

  const { rows } = await db.query(
    `SELECT ${PUBLIC_FIELDS} FROM users ${whereSql}
     ORDER BY ${sortCol} ${sortDir} ${limitSql}`,
    pageValues
  );

  return { rows, total };
}

// Actualiza campos administrables (premium / activo / nombre).
async function adminUpdate(id, { is_premium, is_active, name }) {
  const sets = [];
  const values = [];

  if (is_premium !== undefined) {
    values.push(!!is_premium);
    sets.push(`is_premium = $${values.length}`);
  }
  if (is_active !== undefined) {
    values.push(!!is_active);
    sets.push(`is_active = $${values.length}`);
  }
  if (name !== undefined) {
    values.push(name === null ? null : String(name).trim());
    sets.push(`name = $${values.length}`);
  }

  if (sets.length === 0) return findById(id);

  values.push(id);
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}
     RETURNING ${PUBLIC_FIELDS}`,
    values
  );
  return rows[0] || null;
}

// Borra la cuenta y sus datos personales. Primero cancela la suscripción en Stripe:
// si eso falla no se borra nada, para no dejar a alguien pagando sin cuenta.
async function remove(id) {
  const { rows } = await db.query(
    `SELECT stripe_subscription_id, subscription_status FROM users WHERE id = $1`,
    [id]
  );
  const user = rows[0];
  if (!user) return false;

  if (user.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(user.subscription_status)) {
    await stripeService.cancelSubscriptionNow(user.stripe_subscription_id);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // chat_messages usa ON DELETE SET NULL: se borran explícitamente (contienen texto del usuario).
    await client.query(`DELETE FROM chat_messages WHERE user_id = $1`, [id]);
    await client.query(`DELETE FROM users WHERE id = $1`, [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  try {
    await deletePrefix(`avatars/${id}`);
  } catch (err) {
    console.error(`[users] No se pudieron borrar las fotos de perfil de ${id}:`, err.message);
  }
  return true;
}

// Baja solicitada por el propio usuario: exige la contraseña actual.
async function deleteOwnAccount(id, password) {
  const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [id]);
  const hash = rows[0]?.password_hash;
  if (!hash || !(await bcrypt.compare(String(password || ""), hash))) return false;
  return remove(id);
}

module.exports = {
  register,
  login,
  findById,
  findByEmail,
  listForAdmin,
  adminUpdate,
  remove,
  deleteOwnAccount,
  publicUser,
};
