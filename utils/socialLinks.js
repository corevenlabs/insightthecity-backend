const SOCIAL_FIELDS = { instagramUrl: 'instagram.com', tiktokUrl: 'tiktok.com', facebookUrl: 'facebook.com' };
function normalizeSocialUrl(field, value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const error = () => Object.assign(new Error(`Revisa el enlace de ${field === 'instagramUrl' ? 'Instagram' : field === 'tiktokUrl' ? 'TikTok' : 'Facebook'}; usa la dirección HTTPS del perfil.`), { status: 400 });
  if (typeof value !== 'string' || value.length > 1000) throw error();
  const text = value.trim();
  if (!text) return null;
  let url;
  try { url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`); } catch { throw error(); }
  const domain = SOCIAL_FIELDS[field];
  if (!domain || url.protocol !== 'https:' || url.username || url.password || url.port
    || ![domain, `www.${domain}`, ...(field === 'facebookUrl' ? ['m.facebook.com'] : [])].includes(url.hostname)
    || !url.pathname.replace(/\//g, '') || /^\/(?:l\.php|sharer(?:\.php)?|share|login|accounts)(?:\/|$)/i.test(url.pathname)) throw error();
  return url.href;
}
function validateSocialLinks(body) {
  try { for (const field of Object.keys(SOCIAL_FIELDS)) normalizeSocialUrl(field, body[field]); }
  catch (error) { return error.message; }
  return null;
}
module.exports = { SOCIAL_FIELDS, normalizeSocialUrl, validateSocialLinks };
