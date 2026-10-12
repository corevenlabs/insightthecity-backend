const R = require("./partner-rules");

async function snapshot(c, row) {
  if (row.terms_snapshot?.en) return row.terms_snapshot;
  const { rows } = await c.query(
    "SELECT * FROM partner_terms WHERE variant=$1 AND language='en' AND approved_at IS NOT NULL ORDER BY version DESC LIMIT 1",
    [row.offer],
  );
  if (!rows.length) R.fail("Faltan términos aprobados en inglés para esta oferta", 409);
  const value = { ...row.terms_snapshot, en: rows[0] };
  await c.query("UPDATE partner_clients SET terms_snapshot=$2 WHERE id=$1", [
    row.id, JSON.stringify(value),
  ]);
  row.terms_snapshot = value;
  return value;
}

module.exports = { snapshot };
