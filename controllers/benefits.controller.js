const QRCode = require('qrcode');
const service = require('../services/benefits.service');

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const protocol = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
  return `${protocol}://${req.get('host')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function validationPage(record, token, currentState) {
  const states = {
    valid: { icon: '✓', title: 'BENEFICIO VÁLIDO', message: 'Este código está activo y listo para canjearse.' },
    redeemed: { icon: '✓', title: 'BENEFICIO CANJEADO', message: 'Este código ya fue utilizado y no puede volver a canjearse.' },
    expired: { icon: '×', title: 'CÓDIGO VENCIDO', message: 'La validez de 24 horas terminó o se generó un código nuevo.' },
    invalid: { icon: '×', title: 'CÓDIGO NO VÁLIDO', message: 'No encontramos este beneficio.' },
  };
  const copy = states[currentState];
  const valid = currentState === 'valid';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${copy.title} · ITC Club</title><style>
  :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#050505;color:#fff;display:grid;place-items:center;padding:24px}.card{width:min(100%,520px);background:#121212;border:1px solid #38301a;border-radius:24px;padding:32px;box-shadow:0 24px 70px #000}.brand{color:#FDDD56;font-size:13px;font-weight:900;letter-spacing:.18em}.seal{width:72px;height:72px;border:2px solid #FDDD56;border-radius:50%;display:grid;place-items:center;color:#FDDD56;font-size:38px;margin:28px 0 20px}h1{font-size:26px;line-height:1.15;margin:0 0 10px}p{color:#d0d0d0;line-height:1.55}.benefit{margin:24px 0;padding:20px;background:#090909;border-radius:16px;border-left:3px solid #FDDD56}.benefit strong{display:block;color:#fff;font-size:20px}.meta{font-size:14px;color:#aaa}.expires{color:#FDDD56;font-weight:700}button{width:100%;min-height:52px;border:0;border-radius:14px;background:#FDDD56;color:#050505;font-weight:900;font-size:15px;cursor:pointer}button:focus-visible{outline:3px solid #fff;outline-offset:3px}.note{text-align:center;font-size:12px;color:#777;margin-top:18px}@media(max-width:380px){.card{padding:24px 18px}}
  </style></head><body><main class="card"><div class="brand">INSIGHT THE CITY · ITC CLUB</div><div class="seal" aria-hidden="true">${copy.icon}</div><h1>${copy.title}</h1><p>${copy.message}</p>${record ? `<section class="benefit"><strong>${escapeHtml(record.member_benefit || record.title)}</strong><p>${escapeHtml(record.member_benefit_details || '')}</p><div class="meta">${escapeHtml(record.title)}${record.location ? ` · ${escapeHtml(record.location)}` : ''}</div>${valid ? `<p class="expires">Válido hasta ${new Date(record.expires_at).toLocaleString('es-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })} (hora de NY)</p>` : ''}</section>` : ''}${valid ? `<form method="post" action="/api/benefits/${encodeURIComponent(token)}/redeem" onsubmit="return confirm('¿Confirmas que el beneficio se está entregando ahora? Esta acción no se puede deshacer.');"><button type="submit">CONFIRMAR CANJE</button></form>` : ''}<div class="note">Código único · Un solo uso · No contiene datos personales</div></main></body></html>`;
}

async function issueCode(req, res, next) {
  try {
    const result = await service.issue(req.params.experienceId, req.user.id);
    if (result.error) return res.status(result.status).json({ success: false, message: result.error, code: result.code });
    const validationUrl = `${baseUrl(req)}/benefit/${encodeURIComponent(result.token)}`;
    const qrDataUrl = await QRCode.toDataURL(validationUrl, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#050505', light: '#FFFFFF' } });
    res.status(201).json({ success: true, qrDataUrl, validationUrl, expiresAt: result.expires_at, validForHours: service.VALIDITY_HOURS, reference: `ITC-${result.id}`, title: result.title, benefit: result.member_benefit, instructions: result.benefit_instructions });
  } catch (error) { next(error); }
}

async function showCode(req, res, next) {
  try {
    const record = await service.find(req.params.token);
    res.status(record ? 200 : 404).type('html').send(validationPage(record, req.params.token, service.state(record)));
  } catch (error) { next(error); }
}

async function redeemCode(req, res, next) {
  try {
    await service.redeem(req.params.token);
    const record = await service.find(req.params.token);
    const currentState = service.state(record);
    res.status(record ? 200 : 404).type('html').send(validationPage(record, req.params.token, currentState));
  } catch (error) { next(error); }
}

async function adminDashboard(req, res, next) {
  try {
    res.json(await service.adminDashboard({ region: req.query.region, state: req.query.state, q: req.query.q, from: req.query.from, to: req.query.to }));
  } catch (error) { next(error); }
}

module.exports = { issueCode, showCode, redeemCode, adminDashboard, validationPage };
