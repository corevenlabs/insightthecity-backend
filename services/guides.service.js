const db = require('../config/db');

const FIELDS = `g.id,g.title,g.description,g.category,g.language,g.region,g.access,
  g.cover_url AS "coverUrl",g.pdf_name AS "pdfName",g.pdf_size AS "pdfSize",
  g.page_count AS "pageCount",g.is_featured AS "isFeatured",g.is_published AS "isPublished",
  g.downloads,g.price_cents AS "priceCents",g.currency,
  g.individual_purchase_enabled AS "individualPurchaseEnabled",
  g.included_in_membership AS "includedInMembership",
  g.created_at AS "createdAt",g.updated_at AS "updatedAt"`;

function normalizeMoney(body) {
  const priceCents = Number(body.priceCents ?? 100);
  const currency = String(body.currency || 'usd').trim().toLowerCase();
  if (!Number.isInteger(priceCents) || priceCents < 50) {
    const error = new Error('El precio debe ser un número entero de centavos mayor o igual a 50.');
    error.status = 400;
    throw error;
  }
  if (!/^[a-z]{3}$/.test(currency)) {
    const error = new Error('La moneda debe tener un código válido de 3 letras.');
    error.status = 400;
    throw error;
  }
  return { priceCents, currency };
}

async function list(admin = false, userId = null) {
  const values = [];
  let ownership = 'FALSE';
  if (userId) {
    values.push(userId);
    ownership = `EXISTS (SELECT 1 FROM guide_purchases gp WHERE gp.guide_id=g.id AND gp.user_id=$1 AND gp.status='paid')`;
  }
  const visibility = admin ? '' : 'WHERE g.is_published=TRUE';
  const commerceMetrics = admin
    ? `,(SELECT COUNT(*)::int FROM guide_purchases gp WHERE gp.guide_id=g.id AND gp.status='paid') AS "purchaseCount",
       (SELECT COALESCE(SUM(gp.amount_cents),0)::int FROM guide_purchases gp WHERE gp.guide_id=g.id AND gp.status='paid') AS "revenueCents"`
    : '';
  const { rows } = await db.query(
    `SELECT ${FIELDS}, ${ownership} AS "isPurchased" ${commerceMetrics} FROM guides g ${visibility}
     ORDER BY g.is_featured DESC, g.created_at DESC`,
    values,
  );
  return rows;
}

async function get(id) {
  const { rows } = await db.query(`SELECT ${FIELDS},g.pdf_key AS "pdfKey" FROM guides g WHERE g.id=$1`, [id]);
  return rows[0] || null;
}

async function getUser(userId) {
  const { rows } = await db.query('SELECT id,email,is_premium,is_active FROM users WHERE id=$1', [userId]);
  return rows[0] || null;
}

async function hasPurchase(guideId, userId) {
  const { rowCount } = await db.query(
    "SELECT 1 FROM guide_purchases WHERE guide_id=$1 AND user_id=$2 AND status='paid' LIMIT 1",
    [guideId, userId],
  );
  return rowCount > 0;
}

async function save(id, body) {
  const { priceCents, currency } = normalizeMoney(body);
  const values = [
    body.title,
    body.description || null,
    body.category || null,
    body.language || 'es',
    body.region || 'NY',
    body.access || 'premium',
    body.coverUrl || null,
    body.pdfKey,
    body.pdfName || null,
    Number(body.pdfSize) || 0,
    body.pageCount ? Number(body.pageCount) : null,
    !!body.isFeatured,
    body.isPublished !== false,
    priceCents,
    currency,
    body.individualPurchaseEnabled !== false,
    body.includedInMembership !== false,
  ];
  const sql = id
    ? `UPDATE guides SET title=$1,description=$2,category=$3,language=$4,region=$5,access=$6,
       cover_url=$7,pdf_key=COALESCE($8,pdf_key),pdf_name=COALESCE($9,pdf_name),
       pdf_size=CASE WHEN $8 IS NULL THEN pdf_size ELSE $10 END,page_count=$11,is_featured=$12,
       is_published=$13,price_cents=$14,currency=$15,individual_purchase_enabled=$16,
       included_in_membership=$17,updated_at=NOW() WHERE id=$18 RETURNING id`
    : `INSERT INTO guides(title,description,category,language,region,access,cover_url,pdf_key,pdf_name,
       pdf_size,page_count,is_featured,is_published,price_cents,currency,individual_purchase_enabled,
       included_in_membership) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`;
  if (id) values.push(id);
  const { rows } = await db.query(sql, values);
  return rows[0] ? get(rows[0].id) : null;
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM guides WHERE id=$1', [id]);
  return rowCount > 0;
}

async function download(id, userId) {
  const [guide, user] = await Promise.all([get(id), getUser(userId)]);
  if (!guide || !guide.isPublished) return null;
  if (!user?.is_active) {
    const error = new Error('Tu cuenta no está activa.');
    error.status = 403;
    throw error;
  }
  const membershipAccess = guide.includedInMembership && user.is_premium;
  const purchasedAccess = await hasPurchase(guide.id, userId);
  const freeAccess = guide.access === 'free';
  if (!freeAccess && !membershipAccess && !purchasedAccess) {
    const error = new Error('Compra esta guía o activa ITC Club para descargarla.');
    error.status = 403;
    throw error;
  }
  await db.query('UPDATE guides SET downloads=downloads+1 WHERE id=$1', [id]);
  return guide;
}

async function recordPurchase({ guideId, userId, transactionId, amountCents, currency, provider = 'stripe' }) {
  await db.query(
    `INSERT INTO guide_purchases(guide_id,user_id,provider,transaction_id,amount_cents,currency,status)
     VALUES($1,$2,$3,$4,$5,$6,'paid')
     ON CONFLICT DO NOTHING`,
    [guideId, userId, provider, transactionId, amountCents, currency],
  );
  return get(guideId);
}

module.exports = { list, get, getUser, hasPurchase, save, remove, download, recordPurchase, normalizeMoney };
