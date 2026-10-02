const { normalizeTags, tagsForRecord } = require("../utils/experienceTags");
const service = require("../services/experiences.service");

// Fila DB -> forma de la API (coincide con el tipo Experience de la app Expo).
function serialize(row) {
  if (!row) return null;
  const couponRedeemed = Number(row.coupon_redeemed || 0);
  const couponReserved = Number(row.coupon_reserved || 0);
  const couponAvailable = row.coupon_inventory_mode === 'limited'
    ? Math.max(0, Number(row.coupon_total || 0) - couponRedeemed - couponReserved)
    : null;
  const now = Date.now();
  const couponInWindow = (!row.coupon_starts_at || new Date(row.coupon_starts_at).getTime() <= now)
    && (!row.coupon_ends_at || new Date(row.coupon_ends_at).getTime() > now);
  const couponStatus = row.benefit_action !== 'qr' ? null
    : !row.coupon_active || !couponInWindow ? 'paused'
    : couponAvailable === 0 ? 'sold_out'
    : couponAvailable !== null && couponAvailable <= Number(row.coupon_low_stock || 0) ? 'low_stock' : 'available';
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    tags: tagsForRecord(row),
    image: row.image_url,
    images: row.access === 'premium' ? [row.image_url, ...(Array.isArray(row.gallery_urls) ? row.gallery_urls : [])].filter(Boolean) : [row.image_url].filter(Boolean),
    date: row.date_label,
    location: row.location,
    region: row.region,
    access: row.access,
    description: row.description,
    includes: row.includes || [],
    recommendation: row.recommendation,
    showBenefitOnCard: row.show_benefit_on_card === true,
    cardBenefit: row.card_benefit ?? null,
    memberBenefit: row.member_benefit ?? null,
    memberBenefitDetails: row.member_benefit_details ?? null,
    benefitAction: row.benefit_action || 'none',
    benefitUrl: row.benefit_url ?? null,
    benefitCta: row.benefit_cta ?? null,
    benefitInstructions: row.benefit_instructions ?? null,
    couponInventoryMode: row.coupon_inventory_mode || 'unlimited',
    couponTotal: row.coupon_total == null ? null : Number(row.coupon_total),
    couponPerUser: Number(row.coupon_per_user || 1),
    couponLowStock: Number(row.coupon_low_stock || 0),
    couponStartsAt: row.coupon_starts_at ?? null,
    couponEndsAt: row.coupon_ends_at ?? null,
    couponActive: row.coupon_active !== false,
    couponReserved,
    couponRedeemed,
    couponAvailable,
    couponStatus,
    section: row.section,
    isFeatured: row.is_featured,
    sortOrder: row.sort_order,
    isPublished: row.is_published,
    endsAt: row.ends_at,
    isPaidEvent: row.is_paid_event,
    ticketUrl: row.ticket_url,
    ticketCta: row.ticket_cta,
    isAgeRestricted: row.is_age_restricted === true,
    updatedAt: row.updated_at,
  };
}

// Forma de la API -> columnas del service.
function deserialize(body) {
  return {
    id: body.id,
    title: body.title,
    category: body.tags?.length ? normalizeTags(body.tags)[0] : body.category,
    tags: body.tags,
    image_url: body.images !== undefined ? body.images[0] ?? null : body.image ?? body.image_url,
    gallery_urls: body.images !== undefined ? body.images.slice(1) : undefined,
    date_label: body.date ?? body.date_label,
    location: body.location,
    region: body.region,
    access: body.access,
    description: body.description,
    recommendation: body.recommendation,
    show_benefit_on_card: body.showBenefitOnCard,
    card_benefit: body.cardBenefit === undefined ? undefined : body.cardBenefit?.trim() || null,
    member_benefit: body.memberBenefit === undefined ? undefined : body.memberBenefit?.trim() || null,
    member_benefit_details: body.memberBenefitDetails === undefined ? undefined : body.memberBenefitDetails?.trim() || null,
    benefit_action: body.benefitAction,
    benefit_url: body.benefitUrl === undefined ? undefined : body.benefitUrl?.trim() || null,
    benefit_cta: body.benefitCta === undefined ? undefined : body.benefitCta?.trim() || null,
    benefit_instructions: body.benefitInstructions === undefined ? undefined : body.benefitInstructions?.trim() || null,
    coupon_inventory_mode: body.couponInventoryMode,
    coupon_total: body.couponTotal,
    coupon_per_user: body.couponPerUser,
    coupon_low_stock: body.couponLowStock,
    coupon_starts_at: body.couponStartsAt,
    coupon_ends_at: body.couponEndsAt,
    coupon_active: body.couponActive,
    section: body.section,
    is_featured: body.isFeatured ?? body.is_featured,
    sort_order: body.sortOrder ?? body.sort_order,
    is_published: body.isPublished ?? body.is_published,
    ends_at: body.endsAt ?? body.ends_at,
    is_paid_event: body.isPaidEvent ?? body.is_paid_event,
    ticket_url: body.ticketUrl ?? body.ticket_url,
    ticket_cta: body.ticketCta ?? body.ticket_cta,
    is_age_restricted: body.isAgeRestricted,
    includes: body.includes,
  };
}

function validateMemberBenefit(body, requireBenefit) {
  for (const [field, limit] of [['memberBenefit', 200], ['memberBenefitDetails', 2000], ['cardBenefit', 60]]) {
    if (body[field] != null && (typeof body[field] !== 'string' || body[field].length > limit)) return `${field} debe ser texto de hasta ${limit} caracteres.`;
  }
  if (body.showBenefitOnCard !== undefined && typeof body.showBenefitOnCard !== 'boolean') return 'La opción de mostrar beneficio debe ser verdadero o falso.';
  if (body.isAgeRestricted !== undefined && typeof body.isAgeRestricted !== 'boolean') return 'La opción 21+ debe ser verdadero o falso.';
  if (body.cardBenefit && /[\r\n]/.test(body.cardBenefit)) return 'El beneficio de la tarjeta debe ser un texto breve de una sola línea.';
  if (body.showBenefitOnCard === true && !body.cardBenefit?.trim()) return 'Escribe el beneficio breve que quieres mostrar en la tarjeta.';
  if (requireBenefit && !body.memberBenefit?.trim()) return 'Indica el descuento o beneficio de la membresía.';
  if (body.benefitAction !== undefined && !['none', 'external', 'qr'].includes(body.benefitAction)) return 'Selecciona un método válido para obtener el beneficio.';
  if (body.benefitAction === 'external') {
    try {
      const url = new URL(body.benefitUrl);
      if (url.protocol !== 'https:') throw new Error();
    } catch { return 'Agrega un enlace seguro que comience con https:// para obtener el beneficio.'; }
  }
  if (body.benefitCta != null && (typeof body.benefitCta !== 'string' || body.benefitCta.length > 80)) return 'El texto del botón debe tener hasta 80 caracteres.';
  if (body.benefitInstructions != null && (typeof body.benefitInstructions !== 'string' || body.benefitInstructions.length > 1000)) return 'Las instrucciones deben tener hasta 1000 caracteres.';
  if (body.couponInventoryMode !== undefined && !['limited', 'unlimited'].includes(body.couponInventoryMode)) return 'Selecciona inventario limitado o ilimitado.';
  for (const [field, minimum] of [['couponTotal', 0], ['couponLowStock', 0], ['couponPerUser', 1]]) {
    const isEmptyOptionalTotal = field === 'couponTotal' && body[field] === null;
    if (body[field] !== undefined && !isEmptyOptionalTotal && (!Number.isInteger(body[field]) || body[field] < minimum)) return `${field} debe ser un número entero mayor o igual a ${minimum}.`;
  }
  if (body.benefitAction === 'qr' && body.couponInventoryMode === 'limited' && !Number.isInteger(body.couponTotal)) return 'Indica la cantidad total de cupones.';
  if (body.couponStartsAt && body.couponEndsAt && new Date(body.couponStartsAt) >= new Date(body.couponEndsAt)) return 'La fecha de finalización debe ser posterior al inicio.';
  return null;
}

function validateGallery(body, creating) {
  if (body.images === undefined) {
    if (creating && body.access === 'premium' && body.isPublished !== false) return 'Agrega al menos 4 fotos para publicar una experiencia Premium.';
    return null;
  }
  if (!Array.isArray(body.images) || body.images.length > 8 || body.images.some((url) => {
    if (typeof url !== 'string' || url.length > 500) return true;
    try { return !['http:', 'https:'].includes(new URL(url).protocol); } catch { return true; }
  })) return 'La galería acepta hasta 8 URLs de imágenes válidas.';
  if (new Set(body.images).size !== body.images.length) return 'No repitas la misma foto en la galería.';
  if (body.access === 'premium' && body.isPublished !== false && body.images.length < 4) return 'Agrega al menos 4 fotos para publicar una experiencia Premium.';
  if (body.access === 'free' && body.images.length > 1) return 'Solo las experiencias Premium pueden tener galería.';
  return null;
}

// GET /api/experiences
// - App:  ?section=drops  (solo publicados por defecto)
// - Panel react-admin: ?_start=0&_end=9&_sort=title&_order=ASC&category=DROP
const listExperiences = async (req, res, next) => {
  try {
    const { _start, _end, _sort, _order, section, category, access, region, q, published } = req.query;

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
      filter: { category, access, region, q },
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
    const benefitError = validateMemberBenefit(req.body, req.body.access === 'premium');
    if (benefitError) return res.status(400).json({ success: false, message: benefitError });
    const galleryError = validateGallery(req.body, true);
    if (galleryError) return res.status(400).json({ success: false, message: galleryError });

    if (req.body.tags !== undefined && (!Array.isArray(req.body.tags) || req.body.tags.length > 50 || req.body.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 60) || req.body.tags.length === 0)) {
      return res.status(400).json({ success: false, message: "Selecciona entre 1 y 50 etiquetas de hasta 60 caracteres." });
    }

    if (!req.body.title) {
      return res.status(400).json({ success: false, message: "title es requerido" });
    }
    if (req.body.region && !['NY', 'NJ'].includes(req.body.region)) {
      return res.status(400).json({ success: false, message: "region debe ser NY o NJ" });
    }
    const row = await service.create(deserialize(req.body));
    res.status(201).json(serialize(row));
  } catch (err) {
    next(err);
  }
};

const updateExperience = async (req, res, next) => {
  try {
    const benefitError = validateMemberBenefit(req.body, req.body.access === 'premium' && req.body.memberBenefit !== undefined);
    if (benefitError) return res.status(400).json({ success: false, message: benefitError });
    const galleryError = validateGallery(req.body, false);
    if (galleryError) return res.status(400).json({ success: false, message: galleryError });

    if (req.body.tags !== undefined && (!Array.isArray(req.body.tags) || req.body.tags.length > 50 || req.body.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 60) || req.body.tags.length === 0)) {
      return res.status(400).json({ success: false, message: "Selecciona entre 1 y 50 etiquetas de hasta 60 caracteres." });
    }

    if (req.body.region && !['NY', 'NJ'].includes(req.body.region)) {
      return res.status(400).json({ success: false, message: "region debe ser NY o NJ" });
    }
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
  serialize,
  deserialize,
  validateMemberBenefit,
  validateGallery,
  listExperiences,
  getExperience,
  createExperience,
  updateExperience,
  deleteExperience,
};
