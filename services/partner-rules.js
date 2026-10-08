const crypto = require("crypto");
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
const LANGUAGES = ["en", "es", "pt"];
function language(v) {
  return LANGUAGES.includes(v) ? v : "en";
}
function clean(v, max = 500) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}
function email(v) {
  const s = clean(v, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail("Correo inválido");
  return s;
}
function offer(category, variant, method) {
  if (category === "strategic")
    return {
      category,
      offer: "strategic",
      amount_cents: 0,
      payment_method: "waived",
      payment_status: "waived",
    };
  if (
    category !== "partner" ||
    !["regular", "founding"].includes(variant) ||
    !["stripe", "external"].includes(method)
  )
    fail("Categoría, oferta o pago inválido");
  return {
    category,
    offer: variant,
    amount_cents: variant === "founding" ? 30000 : 120000,
    payment_method: method,
    payment_status: "pending",
  };
}
function addSixMonths(input) {
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) fail("Fecha inválida");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 6);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
function https(v) {
  if (!v) return "";
  let u;
  try {
    u = new URL(v);
  } catch {
    fail("El enlace debe ser HTTPS");
  }
  if (u.protocol !== "https:" || u.username || u.password)
    fail("El enlace debe ser HTTPS");
  return u.href;
}
const FIELDS = {
  businessName: 200,
  contactName: 150,
  businessPhone: 60,
  businessEmail: 254,
  description: 6000,
  address: 500,
  region: 2,
  hours: 1000,
  website: 1000,
  social: 1000,
  benefit: 200,
  cardBenefit: 60,
  conditions: 2000,
  method: 12,
  instructions: 1000,
  url: 1000,
  promoCode: 100,
  validFrom: 40,
  validUntil: 40,
  inventory: 12,
  total: 12,
  perUser: 12,
  signerName: 150,
};
function content(input, submit = false) {
  const data = {};
  for (const [key, max] of Object.entries(FIELDS))
    data[key] = clean(input?.[key], max);
  if (data.businessEmail) data.businessEmail = email(data.businessEmail);
  if (data.website) data.website = https(data.website);
  if (data.url) data.url = https(data.url);
  if (data.region && !["NY", "NJ"].includes(data.region))
    fail("Selecciona NY o NJ");
  if (data.method && !["qr", "external"].includes(data.method))
    fail("Método de beneficio inválido");
  for (const key of ["validFrom", "validUntil"])
    if (data[key] && !Number.isFinite(new Date(data[key]).getTime()))
      fail("Fecha inválida");
  if (
    data.validFrom &&
    data.validUntil &&
    new Date(data.validFrom) >= new Date(data.validUntil)
  )
    fail("Revisa la vigencia del beneficio");
  if (data.inventory && !["limited", "unlimited"].includes(data.inventory))
    fail("Inventario inválido");
  if (
    data.perUser &&
    (!/^\d+$/.test(data.perUser) ||
      Number(data.perUser) < 1 ||
      Number(data.perUser) > 10000)
  )
    fail("Límite por usuario inválido");
  if (data.total && (!/^\d+$/.test(data.total) || Number(data.total) > 1000000))
    fail("Cantidad total inválida");
  if (submit) {
    for (const key of [
      "businessName",
      "description",
      "address",
      "region",
      "hours",
      "benefit",
      "conditions",
      "method",
      "instructions",
      "signerName",
    ])
      if (!data[key]) fail(`Falta: ${key}`);
    if (data.method === "external" && !data.url)
      fail("Falta el enlace del beneficio");
    if (
      data.method === "qr" &&
      (!data.perUser ||
        !data.inventory ||
        (data.inventory === "limited" && !data.total))
    )
      fail("Completa los límites del QR");
  }
  return data;
}
function imageMime(buffer) {
  if (
    buffer
      ?.subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (buffer?.[0] === 255 && buffer?.[1] === 216 && buffer?.[2] === 255)
    return "image/jpeg";
  if (
    buffer?.toString("ascii", 0, 4) === "RIFF" &&
    buffer?.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
function canSee(actor, client) {
  return (
    actor.role === "admin" ||
    actor.role === "editor" ||
    (actor.role === "executive" && Number(client.owner_id) === Number(actor.id))
  );
}
module.exports = {
  fail,
  language,
  clean,
  email,
  offer,
  addSixMonths,
  https,
  content,
  imageMime,
  hash,
  canSee,
  LANGUAGES,
};
