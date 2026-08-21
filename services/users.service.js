const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Auth de usuarios de la app (distinto de los admins del panel).
// La tabla `users` guarda name, email, password_hash, is_premium.

const PUBLIC_FIELDS = "id, name, email, is_premium, created_at";

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
async function register({ name, email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const password_hash = await bcrypt.hash(password, 10);

  const existing = await findByEmail(normalizedEmail);
  if (existing) {
    const err = new Error("Ya existe una cuenta con ese correo");
    err.status = 409;
    throw err;
  }

  const { rows } = await db.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING ${PUBLIC_FIELDS}`,
    [name ? String(name).trim() : null, normalizedEmail, password_hash]
  );

  const user = rows[0];
  return { token: signToken(user), user };
}

// Verifica credenciales. Devuelve { token, user } o null si no coinciden.
async function login(email, password) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await findByEmail(normalizedEmail);
  if (!user || !user.password_hash) return null;

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;

  const publicUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    is_premium: user.is_premium,
    created_at: user.created_at,
  };
  return { token: signToken(publicUser), user: publicUser };
}

module.exports = { register, login, findById, findByEmail };
