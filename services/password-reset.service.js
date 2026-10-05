const { createHmac, randomInt, timingSafeEqual } = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const mailer = require('./password-reset-mail.service');

const RESET_MINUTES = 15;
const REQUEST_DELAY_SECONDS = 60;
const MAX_ATTEMPTS = 5;

function hashCode(userId, code) {
  return createHmac('sha256', process.env.JWT_SECRET).update(`${userId}:${code}`).digest('hex');
}

function emailText(code, language) {
  if (language === 'en') return `Your ITC Club password reset code is ${code}. It expires in ${RESET_MINUTES} minutes. If you did not request this, ignore this email.`;
  if (language === 'pt') return `Seu código para redefinir a senha do ITC Club é ${code}. Ele expira em ${RESET_MINUTES} minutos. Se você não solicitou, ignore este e-mail.`;
  return `Tu código para restablecer la contraseña de ITC Club es ${code}. Vence en ${RESET_MINUTES} minutos. Si no lo solicitaste, ignora este correo.`;
}

async function sendCode(email, code, language) {
  await mailer.send({
      to: [email],
      subject: language === 'en' ? 'Your ITC Club password reset code' : language === 'pt' ? 'Seu código de recuperação ITC Club' : 'Tu código de recuperación ITC Club',
      text: emailText(code, language),
  });
}

async function requestReset(email) {
  if (!mailer.isConfigured()) {
    const error = new Error('La recuperación por correo aún no está disponible');
    error.status = 503;
    throw error;
  }
  const { rows } = await db.query(
    'SELECT id, email, language FROM users WHERE LOWER(email) = $1 AND is_active = TRUE',
    [email.trim().toLowerCase()]
  );
  const user = rows[0];
  if (!user) return;

  const code = String(randomInt(0, 100000000)).padStart(8, '0');
  const codeHash = hashCode(user.id, code);
  const saved = await db.query(
    `INSERT INTO password_reset_codes (user_id, code_hash, expires_at, requested_at, attempts)
     VALUES ($1, $2, NOW() + INTERVAL '15 minutes', NOW(), 0)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash,
       expires_at = EXCLUDED.expires_at, requested_at = NOW(), attempts = 0
     WHERE password_reset_codes.requested_at < NOW() - INTERVAL '60 seconds'
     RETURNING user_id`,
    [user.id, codeHash]
  );
  if (!saved.rowCount) return;
  try {
    await sendCode(user.email, code, user.language);
  } catch (error) {
    await db.query('DELETE FROM password_reset_codes WHERE user_id = $1 AND code_hash = $2', [user.id, codeHash]);
    // La respuesta pública sigue siendo genérica para no revelar si la cuenta existe.
    console.error('No se pudo enviar un correo de recuperación:', error.code || 'MAIL_SEND_FAILED');
  }
}

async function resetPassword(email, code, password) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT r.user_id, r.code_hash, r.expires_at, r.attempts
       FROM password_reset_codes r JOIN users u ON u.id = r.user_id
       WHERE LOWER(u.email) = $1 AND u.is_active = TRUE FOR UPDATE OF r`,
      [email.trim().toLowerCase()]
    );
    const reset = rows[0];
    if (!reset || reset.attempts >= MAX_ATTEMPTS || new Date(reset.expires_at).getTime() <= Date.now()) {
      await client.query('COMMIT');
      return false;
    }
    const expected = Buffer.from(reset.code_hash, 'hex');
    const actual = Buffer.from(hashCode(reset.user_id, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      await client.query('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE user_id = $1', [reset.user_id]);
      await client.query('COMMIT');
      return false;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, reset.user_id]);
    await client.query('DELETE FROM password_reset_codes WHERE user_id = $1', [reset.user_id]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { requestReset, resetPassword, emailText };
