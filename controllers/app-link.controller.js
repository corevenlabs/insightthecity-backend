const { escape, languageOf, GOLD } = require('../services/membership-email.service');
const COPY = {
  es: ['Abrir ITC CLUB', 'Consulta tus beneficios y tu membresía en la app.', 'Abrir la app', 'Si la app no está instalada, instálala desde el enlace que te compartió ITC CLUB. ¿Necesitas ayuda?', 'Contactar soporte'],
  en: ['Open ITC CLUB', 'View your benefits and membership in the app.', 'Open the app', 'If the app is not installed, use the installation link shared by ITC CLUB. Need help?', 'Contact support'],
  pt: ['Abrir ITC CLUB', 'Consulte seus benefícios e sua assinatura no app.', 'Abrir o app', 'Se o app não estiver instalado, use o link de instalação compartilhado pelo ITC CLUB. Precisa de ajuda?', 'Falar com suporte'],
};
function appLink(req, res) {
  if (!['benefits', 'membership'].includes(req.params.target)) return res.status(404).send('Not found');
  const lang = languageOf(req.query.lang); const c = COPY[lang];
  const target = `itcclub://email-entry?target=${req.params.target}`;
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  return res.type('html').send(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c[0]}</title><style>body{background:#0A0A0A;color:white;font-family:-apple-system,system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center}main{max-width:480px;padding:32px;text-align:center}h1{font-size:36px;font-weight:800;letter-spacing:-1px}h1 span{color:${GOLD}}p{line-height:1.7;color:#ccc}a{color:${GOLD}}.button{display:inline-block;background:${GOLD};color:#0A0A0A;border-radius:12px;padding:18px 30px;margin:20px 0;font-weight:800;text-decoration:none}.button:focus-visible{outline:3px solid white;outline-offset:4px}</style></head><body><main><h1>ITC <span>CLUB</span></h1><p>${escape(c[1])}</p><a class="button" href="${escape(target)}">${escape(c[2])}</a><p>${escape(c[3])}</p><a href="mailto:noreply@insightthecity.com">${escape(c[4])}</a></main></body></html>`);
}
module.exports = { appLink };
