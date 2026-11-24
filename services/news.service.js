const axios = require("axios");
const store = require("./news-store.service");

// El contenido vive en el WordPress del cliente. La app NO duplica nada:
// este servicio consume la REST API pública de WordPress, la limpia y la cachea.
const WP_BASE = (process.env.WORDPRESS_API_URL || "https://insightthecity.com/wp-json/wp/v2").replace(/\/+$/, "");
const WP_FALLBACK_BASE = "https://www.insightthecity.com/wp-json/wp/v2";

// Secciones de la app -> id de categoría en WordPress.
const SECTIONS = {
  "ny-al-dia": 58, // "NY al Día"
  "que-hacer": 84, // "QUE HACER EN NY"
};

const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 20;
const LIST_TTL_MS = 5 * 60 * 1000; // 5 min
const POST_TTL_MS = 10 * 60 * 1000; // 10 min
// Tras un fallo se sirve la última copia sin volver a insistir durante este tiempo.
const RETRY_AFTER_FAILURE_MS = 60 * 1000;

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

const failures = new Map();

function recordFailure(key, what, error) {
  failures.set(key, Date.now());
  if (failures.size > 500) failures.delete(failures.keys().next().value);
  const upstream = error.upstream || (error.response ? describe(error.response) : {});
  console.error(`[news] WordPress no disponible (${what}):`, JSON.stringify({ code: wordpressCode(error) || error.code || error.message, ...upstream }));
}

const failedRecently = (key) => Date.now() - (failures.get(key) || 0) < RETRY_AFTER_FAILURE_MS;

// Solo metadatos de la respuesta: nunca se registra el cuerpo.
function describe(response) {
  const header = (name) => String(response.headers?.[name] || "").slice(0, 80) || undefined;
  return { status: response.status, type: header("content-type"), captcha: header("sg-captcha"), ray: header("cf-ray"), body: typeof response.data };
}

// El hosting puede contestar con una página de verificación antibots y un código 2xx.
// Eso no es contenido: cuenta como fallo.
function isPost(post) {
  return Boolean(post) && Number.isInteger(post.id) && !Number.isNaN(Date.parse(post.date)) && typeof post.title?.rendered === "string";
}
const isPostList = (data) => Array.isArray(data) && data.every(isPost);

// Código propio de WordPress (distingue sus errores de los del hosting o Cloudflare).
function wordpressCode(error) {
  const code = error.response?.data?.code;
  return typeof code === "string" ? code : null;
}

// La copia en base de datos nunca debe romper una respuesta que sí llegó de WordPress.
async function best(work) {
  try {
    return await work();
  } catch (error) {
    console.error("[news] Copia local no disponible:", error.code || error.message);
    return null;
  }
}

async function wordpressGet(path, config, valid) {
  const bases = [...new Set([WP_BASE, WP_FALLBACK_BASE])];
  let lastError;
  for (const base of bases) {
    try {
      const response = await axios.get(`${base}${path}`, {
        ...config,
        timeout: 12000,
        headers: { "User-Agent": "InsightTheCity-App/1.0", Accept: "application/json" },
      });
      if (!valid(response.data)) throw Object.assign(new Error("invalid_content"), { upstream: describe(response) });
      return response;
    } catch (error) {
      lastError = error;
      // Una respuesta propia de WordPress (p. ej. nota inexistente) es definitiva.
      if (wordpressCode(error)) break;
    }
  }
  throw lastError;
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

async function listNews({ section, page = 1, perPage = DEFAULT_PER_PAGE, catalog = false }) {
  const catId = resolveCategory(section);
  const p = Math.max(1, Number(page) || 1);
  const pp = Math.min(catalog === true ? 100 : MAX_PER_PAGE, Math.max(1, Number(perPage) || DEFAULT_PER_PAGE));

  const key = `list:${catId}:${p}:${pp}`;
  const { fresh, stale } = cacheGet(key, LIST_TTL_MS);
  if (fresh) return fresh;

  if (failedRecently(key)) {
    const copy = stale || (await best(() => store.list(section, p, pp)));
    if (copy) return copy;
  }

  try {
    const res = await wordpressGet(
      "/posts",
      { params: { categories: catId, page: p, per_page: pp, _embed: 1 } },
      isPostList
    );
    const total = Number(res.headers["x-wp-total"]) || res.data.length;
    const totalPages = Number(res.headers["x-wp-totalpages"]) || 1;
    const value = { items: res.data.map(toCard), page: p, perPage: pp, total, totalPages };
    cacheSet(key, value);
    failures.delete(key);
    await best(() => store.saveList(section, res.data.map(toArticle), { first: p === 1, last: p >= totalPages }));
    return value;
  } catch (err) {
    // Página fuera de rango en WP responde 400: lo tratamos como lista vacía.
    if (wordpressCode(err) === "rest_post_invalid_page_number") {
      return { items: [], page: p, perPage: pp, total: 0, totalPages: 0 };
    }
    recordFailure(key, `lista ${section}`, err);
    // Si WordPress falla pero tenemos una versión anterior, la servimos igual.
    const copy = stale || (await best(() => store.list(section, p, pp)));
    if (copy) return copy;
    const e = new Error("No se pudo obtener el contenido de WordPress");
    e.status = 502;
    throw e;
  }
}

async function getNews(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0 || numId > 2147483647) {
    const err = new Error("ID inválido");
    err.status = 400;
    throw err;
  }

  const key = `post:${numId}`;
  const { fresh, stale } = cacheGet(key, POST_TTL_MS);
  if (fresh) return fresh;

  if (failedRecently(key)) {
    const copy = stale || (await best(() => store.post(numId)));
    if (copy) return copy;
  }

  try {
    const res = await wordpressGet(`/posts/${numId}`, { params: { _embed: 1 } }, isPost);
    const value = toArticle(res.data);
    cacheSet(key, value);
    failures.delete(key);
    await best(() => store.savePost(value));
    return value;
  } catch (err) {
    // WordPress confirma que la nota ya no existe o dejó de ser pública.
    const code = wordpressCode(err);
    if (code === "rest_post_invalid_id" || code === "rest_forbidden") {
      cache.delete(key);
      if (code === "rest_post_invalid_id") await best(() => store.removePost(numId));
      const e = new Error("Nota no encontrada");
      e.status = 404;
      throw e;
    }
    recordFailure(key, `nota ${numId}`, err);
    const copy = stale || (await best(() => store.post(numId)));
    if (copy) return copy;
    const e = new Error("No se pudo obtener la nota de WordPress");
    e.status = 502;
    throw e;
  }
}

module.exports = { listNews, getNews, SECTIONS };
