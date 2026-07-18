const { Pool } = require("pg");

// Soporta tanto conexión TCP local como Cloud SQL vía socket Unix
// (en Cloud Run, DB_HOST = /cloudsql/<INSTANCE_CONNECTION_NAME>).
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: 10,
});

pool.on("error", (err) => {
  console.error("Error inesperado en el pool de Postgres:", err);
});

module.exports = pool;