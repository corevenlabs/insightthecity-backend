const axios = require("axios");

// El contenido vive en el WordPress del cliente. La app NO duplica nada:
// este servicio consume la REST API pública de WordPress, la limpia y la cachea.
const WP_BASE =
  process.env.WORDPRESS_API_URL || "https://insightthecity.com/wp-json/wp/v2";

// Secciones de la app -> id de categoría en WordPress.
const SECTIONS = {
  "ny-al-dia": 58, // "NY al Día"
  "que-hacer": 84, // "QUE HACER EN NY"
};

const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 20;
const LIST_TTL_MS = 5 * 60 * 1000; // 5 min
const POST_TTL_MS = 10 * 60 * 1000; // 10 min

// Caché en memoria simple. Guarda el valor y el momento en que se guardó,
// para poder servir contenido "viejo" si WordPress se cae o va lento.
const cache = new Map();

function cacheGet(key, ttl) {
  const hit = cache.get(key);
  if (!hit) return { fresh: null, stale: null };
  const age = Date.now() - hit.at;
  return { fresh: age < ttl ? hit.value : null, stale: hit.value };
}

function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() });
}

// Decodifica las entidades HTML más comunes que devuelve WordPress en los
// títulos/resúmenes (&#8217; &amp; &nbsp; etc.).
function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Quita etiquetas HTML y colapsa espacios (para el resumen de la tarjeta).
function stripHtml(html) {
  return decodeEntities(String(html || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// Elige una imagen razonable de la media destacada embebida.
function pickImage(post) {
  const media =
    post._embedded &&
    post._embedded["wp:featuredmedia"] &&
    post._embedded["wp:featuredmedia"][0];
  if (!media) return null;
  const sizes = (media.media_details && media.media_details.sizes) || {};
  const pref = sizes.large || sizes.medium_large || sizes.medium || sizes.full;
  return (pref && pref.source_url) || media.source_url || null;
}

// Forma "de tarjeta": lo mínimo que necesita el listado de la app.
function toCard(post) {
  return {
    id: post.id,
    title: decodeEntities(post.title && post.title.rendered),
    excerpt: stripHtml(post.excerpt && post.excerpt.rendered),
    image: pickImage(post),
    date: post.date,
    link: post.link,
  };
}

// Forma completa: incluye el HTML del artículo para la vista de detalle.
function toArticle(post) {
  return {
    ...toCard(post),
    contentHtml: (post.content && post.content.rendered) || "",
  };
}

function resolveCategory(section) {
  const catId = SECTIONS[section];
  if (!catId) {
    const err = new Error(
      `Sección desconocida: '${section}'. Válidas: ${Object.keys(SECTIONS).join(", ")}`
    );
    err.status = 400;
    throw err;
  }
  return catId;
}

async function listNews({ section, page = 1, perPage = DEFAULT_PER_PAGE }) {
  const catId = resolveCategory(section);
  const p = Math.max(1, Number(page) || 1);
  const pp = Math.min(MAX_PER_PAGE, Math.max(1, Number(perPage) || DEFAULT_PER_PAGE));

  const key = `list:${catId}:${p}:${pp}`;
  const { fresh, stale } = cacheGet(key, LIST_TTL_MS);
  if (fresh) return fresh;

  try {
    const res = await axios.get(`${WP_BASE}/posts`, {
      params: { categories: catId, page: p, per_page: pp, _embed: 1 },
      timeout: 8000,
    });
    const items = (res.data || []).map(toCard);
    const total = Number(res.headers["x-wp-total"]) || items.length;
    const totalPages = Number(res.headers["x-wp-totalpages"]) || 1;
    const value = { items, page: p, perPage: pp, total, totalPages };
    cacheSet(key, value);
    return value;
  } catch (err) {
    // Si WordPress falla pero tenemos una versión vieja, la servimos igual.
    if (stale) return stale;
    // Página fuera de rango en WP responde 400: lo tratamos como lista vacía.
    if (err.response && err.response.status === 400) {
      return { items: [], page: p, perPage: pp, total: 0, totalPages: 0 };
    }
    const e = new Error("No se pudo obtener el contenido de WordPress");
    e.status = 502;
    throw e;
  }
}

async function getNews(id) {
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    const err = new Error("ID inválido");
    err.status = 400;
    throw err;
  }

  const key = `post:${numId}`;
  const { fresh, stale } = cacheGet(key, POST_TTL_MS);
  if (fresh) return fresh;

  try {
    const res = await axios.get(`${WP_BASE}/posts/${numId}`, {
      params: { _embed: 1 },
      timeout: 8000,
    });
    const value = toArticle(res.data);
    cacheSet(key, value);
    return value;
  } catch (err) {
    if (stale) return stale;
    if (err.response && err.response.status === 404) {
      const e = new Error("Nota no encontrada");
      e.status = 404;
      throw e;
    }
    const e = new Error("No se pudo obtener la nota de WordPress");
    e.status = 502;
    throw e;
  }
}

module.exports = { listNews, getNews, SECTIONS };
