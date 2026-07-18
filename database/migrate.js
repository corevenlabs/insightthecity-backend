require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../config/db");

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await db.query(sql);
    console.log("✅ Migración aplicada (schema.sql)");
  } catch (err) {
    console.error("❌ Error en migración:", err.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
