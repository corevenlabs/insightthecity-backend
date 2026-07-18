const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

async function findByEmail(email) {
  const { rows } = await db.query(`SELECT * FROM admins WHERE email = $1`, [email]);
  return rows[0] || null;
}

async function createAdmin({ email, password, name }) {
  const password_hash = await bcrypt.hash(password, 10);
  const { rows } = await db.query(
    `INSERT INTO admins (email, password_hash, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name
     RETURNING id, email, name`,
    [email, password_hash, name || null]
  );
  return rows[0];
}

async function login(email, password) {
  const admin = await findByEmail(email);
  if (!admin) return null;

  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) return null;

  const token = jwt.sign(
    { id: admin.id, email: admin.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  return { token, admin: { id: admin.id, email: admin.email, name: admin.name } };
}

module.exports = { login, createAdmin, findByEmail };
