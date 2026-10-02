// Destinos válidos para volver a la app después de Stripe. Solo esquemas de la app
// (producción y Expo en desarrollo): evita usar la página puente como open redirect.
const APP_URL_RE = /^(itcclub|exp|exps):\/\/[^\s"'<>]*$/i;

function isAllowedAppUrl(value) {
  return typeof value === 'string' && value.length <= 500 && APP_URL_RE.test(value);
}

// URL pública del backend: PUBLIC_BASE_URL o el host de la petición (Cloud Run es https).
function publicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto')?.split(',')[0] || req.protocol;
  return `${proto}://${req.get('host')}`;
}

module.exports = { isAllowedAppUrl, publicBaseUrl };
