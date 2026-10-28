const COPY = {
  es: 'Quiero recibir promociones, novedades e información de Insight The City por correo electrónico.',
  en: 'I want to receive promotions, news and information from Insight The City by email.',
  pt: 'Quero receber promoções, novidades e informações da Insight The City por e-mail.',
};
const VERSION = '2026-10-28.1';
function validate(value) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw Object.assign(new Error('La preferencia de promociones debe ser verdadera o falsa.'), { status: 400 });
  }
}
// Called only inside the new-user transaction; a later login never changes this preference.
async function recordRegistration(client, { userId, accepted, language, source }) {
  validate(accepted);
  if (accepted !== true) return;
  const locale = Object.hasOwn(COPY, language) ? language : 'es';
  await client.query(`UPDATE users SET marketing_opt_in = TRUE, marketing_consent_at = NOW(),
    marketing_consent_version = $2, marketing_consent_language = $3,
    marketing_consent_text = $4, marketing_consent_source = $5 WHERE id = $1`,
    [userId, VERSION, locale, COPY[locale], source]);
}
module.exports = { COPY, VERSION, validate, recordRegistration };
