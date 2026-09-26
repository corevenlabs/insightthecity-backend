const passwordReset = require('../services/password-reset.service');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requestReset(req, res, next) {
  const email = String(req.body?.email || '').trim();
  if (!EMAIL_RE.test(email) || email.length > 255) return res.status(400).json({ success: false, message: 'Correo inválido' });
  try {
    await passwordReset.requestReset(email);
    res.json({ success: true, message: 'Si existe una cuenta activa con ese correo, recibirás un código de recuperación.' });
  } catch (error) {
    if (error.status === 503) return res.status(503).json({ success: false, message: error.message });
    next(error);
  }
}

async function resetPassword(req, res, next) {
  const email = String(req.body?.email || '').trim();
  const code = String(req.body?.code || '').trim();
  const password = req.body?.password;
  if (!EMAIL_RE.test(email) || email.length > 255 || !/^\d{8}$/.test(code) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ success: false, message: 'Revisa el correo, el código de 8 dígitos y la contraseña (mínimo 8 caracteres).' });
  }
  try {
    const changed = await passwordReset.resetPassword(email, code, password);
    if (!changed) return res.status(400).json({ success: false, message: 'Código inválido o vencido. Solicita uno nuevo.' });
    res.json({ success: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (error) {
    next(error);
  }
}

module.exports = { requestReset, resetPassword };
