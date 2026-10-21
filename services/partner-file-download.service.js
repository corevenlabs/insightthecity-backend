function safePart(value, fallback) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}
function imageName(business, file) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.mime];
  if (!extension) throw new Error('Unsupported partner image type');
  return `${safePart(business, 'ITC-CLUB')}-${file.kind === 'logo' ? 'logo' : 'foto'}-${safePart(file.id, 'imagen')}.${extension}`;
}
module.exports = { safePart, imageName };
