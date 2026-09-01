const service = require('../services/partnerships.service');

function serialize(row) {
  if (!row) return null;
  return {
    brandName: row.brand_name,
    title: row.title,
    description: row.description,
    image: row.image_url,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    isPublished: row.is_published,
    updatedAt: row.updated_at,
  };
}

async function getFeatured(req, res, next) {
  try {
    const partnership = serialize(await service.getFeatured());
    if (!partnership) {
      return res.status(404).json({ success: false, message: 'Partnership no disponible' });
    }
    return res.json({ success: true, partnership });
  } catch (error) {
    return next(error);
  }
}

async function updateFeatured(req, res, next) {
  try {
    if (!String(req.body.brandName || '').trim() || !String(req.body.title || '').trim()) {
      return res.status(400).json({ success: false, message: 'Marca y título son obligatorios' });
    }
    const partnership = serialize(await service.updateFeatured(req.body));
    return res.json({ success: true, partnership });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getFeatured, updateFeatured };
