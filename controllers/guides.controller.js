const service = require('../services/guides.service');
const stripeService = require('../services/stripe.service');
const { uploadPrivatePdf, streamPrivatePdf } = require('../services/uploads.service');
const { createGuideDownloadToken, verifyGuideDownloadToken } = require('../services/guide-download-token.service');
const { isAllowedAppUrl, publicBaseUrl } = require('../utils/appReturn');

const list = async (req, res, next) => {
  try { res.json(await service.list(Boolean(req.admin))); } catch (error) { next(error); }
};

const listMine = async (req, res, next) => {
  try { res.json(await service.list(false, req.user.id)); } catch (error) { next(error); }
};

const upload = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Selecciona un PDF.' });
    res.json(await uploadPrivatePdf(req.file));
  } catch (error) { next(error); }
};

const create = async (req, res, next) => {
  try {
    if (!req.body.title || !req.body.pdfKey) return res.status(400).json({ message: 'Título y PDF son obligatorios.' });
    res.status(201).json(await service.save(null, req.body));
  } catch (error) { next(error); }
};

const update = async (req, res, next) => {
  try {
    const guide = await service.save(req.params.id, req.body);
    if (!guide) return res.status(404).json({ message: 'Guía no encontrada' });
    res.json(guide);
  } catch (error) { next(error); }
};

const remove = async (req, res, next) => {
  try { res.json({ success: await service.remove(req.params.id) }); } catch (error) { next(error); }
};

const download = async (req, res, next) => {
  try {
    const guide = await service.download(req.params.id, req.user.id);
    if (!guide) return res.status(404).json({ message: 'Guía no encontrada' });
    const ticket = createGuideDownloadToken(guide.id, req.user.id);
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${base}/api/guides/${guide.id}/file?ticket=${encodeURIComponent(ticket)}` });
  } catch (error) { next(error); }
};

const createPurchaseSession = async (req, res, next) => {
  try {
    const appReturnUrl = req.body?.returnUrl;
    if (!isAllowedAppUrl(appReturnUrl)) return res.status(400).json({ message: 'URL de retorno inválida.' });
    const [guide, user] = await Promise.all([service.get(req.params.id), service.getUser(req.user.id)]);
    if (!guide?.isPublished) return res.status(404).json({ message: 'Guía no encontrada' });
    if (!user?.is_active) return res.status(403).json({ message: 'Tu cuenta no está activa.' });
    if (guide.access === 'free' || (guide.includedInMembership && user.is_premium) || await service.hasPurchase(guide.id, user.id)) {
      return res.json({ alreadyOwned: true });
    }
    if (!guide.individualPurchaseEnabled) {
      return res.status(409).json({ message: 'Esta guía solo está disponible con ITC Club.' });
    }
    const session = await stripeService.createGuideCheckoutSession({ guide, user, baseUrl: publicBaseUrl(req), appReturnUrl });
    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (error) { next(error); }
};

const confirmPurchase = async (req, res, next) => {
  try {
    const sessionId = String(req.body?.sessionId || '');
    if (!sessionId.startsWith('cs_')) return res.status(400).json({ message: 'Sesión de compra inválida.' });
    const session = await stripeService.retrieveCheckoutSession(sessionId);
    const matches = session.metadata?.purchase_type === 'guide'
      && String(session.metadata?.guide_id) === String(req.params.id)
      && String(session.metadata?.user_id) === String(req.user.id);
    if (!matches || session.payment_status !== 'paid') {
      return res.status(409).json({ message: 'El pago todavía no ha sido confirmado.' });
    }
    const guide = await service.recordPurchase({
      guideId: req.params.id,
      userId: req.user.id,
      transactionId: session.id,
      amountCents: Number(session.amount_total || session.metadata?.price_cents || 0),
      currency: String(session.currency || session.metadata?.currency || 'usd'),
    });
    res.json({ success: true, guide });
  } catch (error) { next(error); }
};

const file = async (req, res, next) => {
  try {
    verifyGuideDownloadToken(req.query.ticket, req.params.id);
    const guide = await service.get(req.params.id);
    if (!guide || !guide.isPublished) return res.status(404).send('Guía no encontrada');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(guide.pdfName || 'guia.pdf')}`);
    res.setHeader('Cache-Control', 'private, no-store');
    const stream = streamPrivatePdf(guide.pdfKey, res);
    stream.on('error', (error) => res.headersSent ? res.destroy(error) : next(error));
  } catch (error) {
    error.status = 401;
    next(error);
  }
};

module.exports = { list, listMine, upload, create, update, remove, download, createPurchaseSession, confirmPurchase, file };
