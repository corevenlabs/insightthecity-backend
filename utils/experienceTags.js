function normalizeTags(tags) {
  const seen = new Set();
  return tags.map((tag) => tag.trim()).filter((tag) => {
    const key = tag.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function tagsForRecord(row) {
  const tags = row.tags?.length ? row.tags : [row.category].filter(Boolean);
  return normalizeTags(tags);
}
module.exports = { normalizeTags, tagsForRecord };
