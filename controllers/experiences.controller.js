const service = require("../services/experiences.service");

// Fila DB -> forma de la API (coincide con el tipo Experience de la app Expo).
function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    image: row.image_url,
    date: row.date_label,
    location: row.location,
    access: row.access,
    description: row.description,
    includes: row.includes || [],
    recommendation: row.recommendation,
    section: row.section,
    isFeatured: row.is_featured,
    sortOrder: row.sort_order,
    isPublished: row.is_published,
    endsAt: row.ends_at,
    isPaidEvent: row.is_paid_event,
    ticketUrl: row.ticket_url,
    ticketCta: row.ticket_cta,
    updatedAt: row.updated_at,
  };
}

// Forma de la API -> columnas del service.
function deserialize(body) {
  return {
    id: body.id,
    title: body.title,
    category: body.category,
    image_url: body.image ?? body.image_url,
    date_label: body.date ?? body.date_label,
    location: body.location,
    access: body.access,
    description: body.description,
    recommendation: body.recommendation,
    section: body.section,
    is_featured: body.isFeatured ?? body.is_featured,
    sort_order: body.sortOrder ?? body.sort_order,
    is_published: body.isPublished ?? body.is_published,
    ends_at: body.endsAt ?? body.ends_at,
    is_paid_event: body.isPaidEvent ?? body.is_paid_event,
    ticket_url: body.ticketUrl ?? body.ticket_url,
    ticket_cta: body.ticketCta ?? body.ticket_cta,
    includes: body.includes,
  };
}

// GET /api/experiences
// - App:  ?section=drops  (solo publicados por defecto)
// - Panel react-admin: ?_start=0&_end=9&_sort=title&_order=ASC&category=DROP
const listExperiences = async (req, res, next) => {
  try {
    const { _start, _end, _sort, _order, section, category, access, q, published } = req.query;

    const start = _start !== undefined ? parseInt(_start, 10) : undefined;
    const end = _end !== undefined ? parseInt(_end, 10) : undefined;

    // Por defecto la API es pública (solo publicados). El panel pasa ?published=all.
    const publishedOnly = published !== "all";

    const { rows, total } = await service.list({
      section,
      publishedOnly,
      sort: _sort,
      order: _order,
      start,
      end,
      filter: { category, access, q },
    });

    // Header que react-admin (ra-data-simple-rest) necesita para la paginación.
    res.set("Content-Range", `experiences ${start || 0}-${Math.max((start || 0), (end || rows.length) - 1)}/${total}`);
    res.json(rows.map(serialize));
  } catch (err) {
    next(err);
  }
};

const getExperience = async (req, res, next) => {
  try {
    const row = await service.getById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "No encontrado" });
    res.json(serialize(row));
  } catch (err) {
    next(err);
  }
};

const createExperience = async (req, res, next) => {
  try {
    if (!req.body.title) {
      return res.status(400).json({ success: false, message: "title es requerido" });
    }
    const row = await service.create(deserialize(req.body));
    res.status(201).json(serialize(row));
  } catch (err) {
    next(err);
  }
};

const updateExperience = async (req, res, next) => {
  try {
    const row = await service.update(req.params.id, deserialize(req.body));
    if (!row) return res.status(404).json({ success: false, message: "No encontrado" });
    res.json(serialize(row));
  } catch (err) {
    next(err);
  }
};

const deleteExperience = async (req, res, next) => {
  try {
    const existing = await service.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "No encontrado" });
    await service.remove(req.params.id);
    res.json(serialize(existing)); // react-admin espera el registro borrado
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listExperiences,
  getExperience,
  createExperience,
  updateExperience,
  deleteExperience,
};
