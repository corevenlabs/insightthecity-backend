// Convierte un título en un slug estable usable como id.
function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // quita acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || `item-${Date.now()}`;
}

module.exports = { slugify };
