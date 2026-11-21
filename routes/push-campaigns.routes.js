const router = require('express').Router();
const { requireStaff } = require('../middleware/staff');
const security = require('../middleware/security-rate-limit');
const campaigns = require('../services/push-campaigns.service');

// Push campaigns from the panel. Only administrators can write and send them.
const handle = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)); }
  catch (error) { if (error.status) return res.status(error.status).json({ success: false, message: error.message }); next(error); }
};
const admin = requireStaff('admin');

router.get('/', admin, handle(() => campaigns.list()));
router.get('/audience', admin, handle((req) => campaigns.audience({ audience: req.query.audience, language: req.query.language })));
router.post('/test', admin, security.limit('push-campaign-test', 20, 3600, security.staff), handle((req) => campaigns.testSend(req.body || {}, req.admin)));
router.get('/:id', admin, handle((req) => campaigns.get(req.params.id)));
router.post('/', admin, security.limit('push-campaign-write', 120, 3600, security.staff), handle((req) => campaigns.create(req.body || {}, req.admin)));
router.put('/:id', admin, security.limit('push-campaign-write', 120, 3600, security.staff), handle((req) => campaigns.update(req.params.id, req.body || {}, req.admin)));
router.delete('/:id', admin, handle((req) => campaigns.remove(req.params.id)));
router.post('/:id/schedule', admin, security.limit('push-campaign-send', 20, 3600, security.staff), handle((req) => campaigns.schedule(req.params.id, req.body || {}, req.admin)));
router.post('/:id/cancel', admin, handle((req) => campaigns.cancel(req.params.id)));

module.exports = router;
