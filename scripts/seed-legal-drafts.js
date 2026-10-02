require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../config/db");

// Crea borradores (sin publicar) de los documentos legales en español a partir de
// database/legal-drafts/*.md, solo para los tipos que todavía no tienen ninguna versión.
// Los marcadores [COMPLETAR: …] deben resolverse (con el abogado) antes de publicar en el panel.

const TITLES = {
  terms: "Términos y Condiciones",
  privacy: "Política de Privacidad",
  subscription: "Términos de la membresía ITC Club",
  accessibility: "Declaración de accesibilidad",
};

(async () => {
  try {
    for (const [slug, title] of Object.entries(TITLES)) {
      const { rowCount } = await db.query(
        "SELECT 1 FROM legal_documents WHERE slug = $1 AND language = 'es' LIMIT 1",
        [slug]
      );
      if (rowCount) {
        console.log(`· ${slug}: ya existe, se omite`);
        continue;
      }
      const content = fs.readFileSync(path.join(__dirname, "..", "database", "legal-drafts", `${slug}.md`), "utf8");
      await db.query(
        `INSERT INTO legal_documents (slug, language, version, title, content) VALUES ($1, 'es', 1, $2, $3)`,
        [slug, title, content]
      );
      console.log(`✓ ${slug}: borrador creado`);
    }
  } catch (err) {
    console.error("❌ Error creando borradores legales:", err.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
