const express = require("express");
const multer = require("multer");
const router = express.Router();
const S = require("../services/partner-crm.service");
const R = require("../services/partner-rules");
const db = require("../config/db");
const { requireStaff } = require("../middleware/staff");
const all = requireStaff("admin", "editor", "executive");
const admin = requireStaff("admin");
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  next();
});
router.get(
  "/clients",
  all,
  wrap(async (req, res) => res.json(await S.list(req.admin))),
);
router.post(
  "/clients",
  all,
  wrap(async (req, res) =>
    res.status(201).json(await S.create(req.body, req.admin)),
  ),
);
router.get(
  "/clients/:id",
  all,
  wrap(async (req, res) => res.json(await S.detail(req.params.id, req.admin))),
);
router.post(
  "/clients/:id/actions",
  all,
  wrap(async (req, res) =>
    res.json(await S.action(req.params.id, req.body, req.admin)),
  ),
);
router.get(
  "/clients/:id/files/:file",
  all,
  wrap(async (req, res) => {
    const f = await S.fileGet(req.params.id, req.params.file, req.admin);
    res.set("X-Content-Type-Options", "nosniff").type(f.mime).send(f.bytes);
  }),
);
router.get(
  "/clients/:id/download",
  all,
  wrap(async (req, res) => {
    const row = await S.get(db, req.params.id, req.admin);
    const files = (
      await db.query("SELECT * FROM partner_files WHERE client_id=$1", [row.id])
    ).rows;
    const detail = await S.detail(row.id, req.admin);
    const { ZipArchive } = await import("archiver");
    const PDF = require("pdfkit");
    const archive = new ZipArchive({ zlib: { level: 6 } });
    res.attachment(`ITC-CLUB-${row.id}.zip`);
    archive.on("error", () => res.destroy());
    res.on("close", () => archive.abort());
    archive.pipe(res);
    const pdf = new PDF({ margin: 45 });
    archive.append(pdf, { name: "business-information.pdf" });
    pdf.fontSize(22).text("ITC CLUB");
    pdf.moveDown().fontSize(16).text(row.business_name);
    pdf.moveDown().fontSize(11);
    for (const [k, v] of Object.entries(row.content)) {
      if (v) pdf.text(`${k}: ${v}`).moveDown(0.4);
    }
    pdf.end();
    archive.append(JSON.stringify(detail, null, 2), {
      name: "information.json",
    });
    archive.append(
      Object.entries(row.content)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n\n"),
      { name: "business-information.txt" },
    );
    if (req.admin.role !== "editor")
      archive.append(JSON.stringify(detail.acceptances, null, 2), {
        name: "accepted-agreements.json",
      });
    files.forEach((f) =>
      archive.append(f.bytes, { name: `${f.kind}/${f.id}-${f.name}` }),
    );
    await archive.finalize();
  }),
);
router.get(
  "/owners",
  all,
  wrap(async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT id,name,email,phone,role FROM admins WHERE is_active AND role IN ('admin','executive') AND ($1::boolean OR id=$2) ORDER BY name,email",
          [req.admin.role === "admin", req.admin.id],
        )
      ).rows,
    ),
  ),
);
router.get(
  "/terms",
  admin,
  wrap(async (_req, res) =>
    res.json(
      (
        await db.query(
          "SELECT t.*,a.name AS author FROM partner_terms t JOIN admins a ON a.id=t.created_by ORDER BY variant,language,version DESC",
        )
      ).rows,
    ),
  ),
);
router.post(
  "/terms",
  admin,
  wrap(async (req, res) => {
    const { variant, language, title, content, approve } = req.body;
    if (
      !["regular", "founding", "strategic"].includes(variant) ||
      !R.LANGUAGES.includes(language) ||
      !R.clean(title, 250) ||
      !R.clean(content, 100000)
    )
      R.fail("Completa oferta, idioma, título y texto");
    const row = await S.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(731923)");
      return (
        await c.query(
          "INSERT INTO partner_terms(variant,language,version,title,content,approved_at,created_by) SELECT $1,$2,COALESCE(MAX(version),0)+1,$3,$4,CASE WHEN $5 THEN NOW() ELSE NULL END,$6 FROM partner_terms WHERE variant=$1 AND language=$2 RETURNING *",
          [
            variant,
            language,
            R.clean(title, 250),
            R.clean(content, 100000),
            approve === true,
            req.admin.id,
          ],
        )
      ).rows[0];
    });
    res.status(201).json(row);
  }),
);
router.post(
  "/terms/:id/approve",
  admin,
  wrap(async (req, res) => {
    const row = (
      await db.query(
        "UPDATE partner_terms SET approved_at=COALESCE(approved_at,NOW()) WHERE id=$1 RETURNING *",
        [req.params.id],
      )
    ).rows[0];
    if (!row) R.fail("Documento no encontrado", 404);
    res.json(row);
  }),
);
const limit = require("../middleware/partner-rate-limit")(120);
function token(req) {
  const value = req.headers.authorization || "";
  if (!value.startsWith("Partner ")) R.fail("Falta el enlace privado", 401);
  return value.slice(8);
}
router.use("/access", limit);
router.get(
  "/access",
  wrap(async (req, res) => res.json(await S.publicView(token(req)))),
);
router.post(
  "/access/save",
  wrap(async (req, res) => res.json(await S.save(token(req), req.body))),
);
router.post(
  "/access/submit",
  wrap(async (req, res) => res.json(await S.save(token(req), req.body, true))),
);
router.post(
  "/access/checkout",
  wrap(async (req, res) => res.json(await S.checkout(token(req), req.body))),
);
router.post(
  "/access/sync",
  wrap(async (req, res) => res.json(await S.sync(token(req)))),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 1 },
});
// Authenticate before reading potentially large multipart content.
router.post(
  "/access/files",
  async (req, _res, next) => {
    try {
      await S.fromToken(token(req));
      next();
    } catch (e) {
      next(e);
    }
  },
  upload.single("file"),
  wrap(async (req, res) =>
    res.status(201).json(await S.filePut(token(req), req.file, req.body.kind)),
  ),
);
router.get(
  "/access/files/:file",
  wrap(async (req, res) => {
    const f = await S.fileGet(null, req.params.file, null, token(req));
    res.set("X-Content-Type-Options", "nosniff").type(f.mime).send(f.bytes);
  }),
);
router.delete(
  "/access/files/:file",
  wrap(async (req, res) =>
    res.json(await S.fileDelete(token(req), req.params.file)),
  ),
);
router.use("/access", (err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    err.status = 400;
    err.message = "El archivo supera el límite permitido";
  }
  if (!err.status || err.status >= 500) return next(err);
  const lang = R.language((req.headers["accept-language"] || "en").slice(0, 2));
  res
    .status(err.status)
    .json({
      message: require("../services/partner-public-copy").localized(
        err.message,
        lang,
      ),
    });
});
module.exports = router;
