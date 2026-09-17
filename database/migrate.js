require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../config/db");

(async () => {
  try {
    for (const file of ["schema.sql", "experience-gallery.sql"]) {
      const sql = fs.readFileSync(path.join(__dirname, file), "utf8");
      await db.query(sql);
      console.log(`✅ Migración aplicada (${file})`);
    }
  } catch (err) {
    console.error("❌ Error en migración:", err.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
