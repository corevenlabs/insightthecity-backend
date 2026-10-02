const legal = require("../services/legal.service");
const { escapeHtml, toHtml } = require("../utils/legalMarkdown");

function pickLanguage(value) {
  return legal.LANGUAGES.includes(value) ? value : "es";
}

// GET /api/legal/:slug?lang=es — versión vigente (la consume la app).
const getCurrent = async (req, res, next) => {
  try {
    if (!legal.SLUGS.includes(req.params.slug)) {
      return res.status(404).json({ success: false, message: "Documento no encontrado" });
    }
    const document = await legal.getCurrent(req.params.slug, pickLanguage(req.query.lang));
    if (!document) return res.status(404).json({ success: false, message: "Este documento aún no está publicado" });
    res.json({ success: true, document });
  } catch (err) {
    next(err);
  }
};

// GET /legal/:slug?lang=es — página pública (URL para App Store / Google Play y la web).
const page = async (req, res, next) => {
  try {
    if (!legal.SLUGS.includes(req.params.slug)) return res.status(404).send("Documento no encontrado");
    const language = pickLanguage(req.query.lang);
    const document = await legal.getCurrent(req.params.slug, language);
    if (!document) return res.status(404).send("Documento no publicado");
    const date = new Date(document.publishedAt).toISOString().slice(0, 10);
    const updated = { es: "Última actualización", en: "Last updated", pt: "Última atualização" }[document.language];
    res.set("Cache-Control", "public, max-age=300");
    res.type("html").send(`<!DOCTYPE html>
<html lang="${document.language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(document.title)} · ITC Club</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, system-ui, sans-serif; line-height: 1.65; background: #fff; color: #1a1a1a; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 6px; }
  h2 { font-size: 21px; margin: 32px 0 8px; }
  h3, h4 { font-size: 17px; margin: 24px 0 6px; }
  .meta { color: #555; font-size: 14px; margin-bottom: 28px; }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #ececec; } .meta { color: #b3b3b3; } }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(document.title)}</h1>
<div class="meta">${updated}: ${date} · v${document.version}</div>
${toHtml(document.content)}
</main>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
};

// ---- Administración (panel) ----

function validate(body, { partial }) {
  const { slug, language, title, content } = body || {};
  if (!partial) {
    if (!legal.SLUGS.includes(slug)) return "Tipo de documento inválido.";
    if (!legal.LANGUAGES.includes(language)) return "Idioma inválido.";
  }
  if ((!partial || title !== undefined) && (typeof title !== "string" || !title.trim() || title.length > 200)) {
    return "El título es obligatorio (máx. 200 caracteres).";
  }
  if ((!partial || content !== undefined) && (typeof content !== "string" || !content.trim() || content.length > 100000)) {
    return "El contenido es obligatorio.";
  }
  return null;
}

const list = async (req, res, next) => {
  try { res.json(await legal.listAll()); } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const error = validate(req.body, { partial: false });
    if (error) return res.status(400).json({ success: false, message: error });
    const { slug, language, title, content } = req.body;
    res.status(201).json(await legal.createDraft({ slug, language, title: title.trim(), content }));
  } catch (err) {
    next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const error = validate(req.body, { partial: true });
    if (error) return res.status(400).json({ success: false, message: error });
    const document = await legal.updateDraft(req.params.id, {
      title: req.body.title?.trim(),
      content: req.body.content,
    });
    if (!document) return res.status(409).json({ success: false, message: "Solo se pueden editar borradores. Crea una nueva versión." });
    res.json(document);
  } catch (err) {
    next(err);
  }
};

const publish = async (req, res, next) => {
  try {
    const draft = await legal.get(req.params.id);
    if (draft && /\[COMPLETAR/i.test(`${draft.title}\n${draft.content}`)) {
      return res.status(409).json({ success: false, message: "Completa todos los campos marcados [COMPLETAR: …] antes de publicar." });
    }
    const document = await legal.publish(req.params.id);
    if (!document) return res.status(409).json({ success: false, message: "El documento no existe o ya está publicado." });
    res.json(document);
  } catch (err) {
    next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    const ok = await legal.removeDraft(req.params.id);
    if (!ok) return res.status(409).json({ success: false, message: "Solo se pueden eliminar borradores." });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCurrent, page, list, create, update, publish, remove };
