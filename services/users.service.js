const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Auth de usuarios de la app (distinto de los admins del panel).
// La tabla `users` guarda name, email, password_hash, is_premium, is_active.

const PUBLIC_FIELDS = "id, name, email, is_premium, is_active, language, created_at";

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

// Crea una cuenta. Devuelve { token, user } o lanza { status, message }.
async function register({ name, email, password, language = "es" }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const password_hash = await bcrypt.hash(password, 10);

  const existing = await findByEmail(normalizedEmail);
  if (existing) {
    const err = new Error("Ya existe una cuenta con ese correo");
    err.status = 409;
    throw err;
  }

  const { rows } = await db.query(
    `INSERT INTO users (name, email, password_hash, language)
     VALUES ($1, $2, $3, $4)
     RETURNING ${PUBLIC_FIELDS}`,
    [name ? String(name).trim() : null, normalizedEmail, password_hash, language]
  );

  const user = rows[0];
  return { token: signToken(user), user };
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

  const publicUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    is_premium: user.is_premium,
    is_active: user.is_active,
    language: user.language || "es",
    created_at: user.created_at,
  };
  return { token: signToken(publicUser), user: publicUser };
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

async function remove(id) {
  const { rowCount } = await db.query(`DELETE FROM users WHERE id = $1`, [id]);
  return rowCount > 0;
}

module.exports = {
  register,
  login,
  findById,
  findByEmail,
  listForAdmin,
  adminUpdate,
  remove,
};
