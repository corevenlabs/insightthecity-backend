const db = require('../config/db');

async function getFeatured() {
  const { rows } = await db.query('SELECT * FROM featured_partnership WHERE id = 1');
  return rows[0] || null;
}

async function updateFeatured(data) {
  const { rows } = await db.query(
    `INSERT INTO featured_partnership
      (id, brand_name, title, description, image_url, cta_label, cta_url, is_published)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       brand_name = EXCLUDED.brand_name,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       image_url = EXCLUDED.image_url,
       cta_label = EXCLUDED.cta_label,
       cta_url = EXCLUDED.cta_url,
       is_published = EXCLUDED.is_published
     RETURNING *`,
    [
      data.brandName,
      data.title,
      data.description || null,
      data.image || null,
      data.ctaLabel || null,
      data.ctaUrl || null,
      data.isPublished !== false,
    ],
  );
  return rows[0];
}

module.exports = { getFeatured, updateFeatured };
