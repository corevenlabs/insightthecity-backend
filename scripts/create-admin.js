require("dotenv").config();
const db = require("../config/db");
const { createAdmin } = require("../services/auth.service");

// Uso: node scripts/create-admin.js <email> <password> [nombre]
//   o con env: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME
(async () => {
  const email = process.argv[2] || process.env.ADMIN_EMAIL;
  const password = process.argv[3] || process.env.ADMIN_PASSWORD;
  const name = process.argv[4] || process.env.ADMIN_NAME || "Admin";

  if (!email || !password) {
    console.error("Uso: node scripts/create-admin.js <email> <password> [nombre]");
    process.exitCode = 1;
    return;
  }

  try {
    const admin = await createAdmin({ email, password, name });
    console.log("✅ Admin creado/actualizado:", admin);
  } catch (err) {
    console.error("❌ Error creando admin:", err.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
