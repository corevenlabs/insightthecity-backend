require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../config/db");
(async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(fs.readFileSync(path.join(__dirname, "tags.sql"), "utf8"));
    await client.query("COMMIT");
    console.log("Etiquetas migradas; categorías existentes conservadas.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await db.end();
  }
})().catch((err) => { console.error("No se pudo migrar:", err.code || err.message); process.exitCode = 1; });
