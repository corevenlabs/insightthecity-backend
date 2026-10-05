const nodemailer = require('nodemailer');

function smtpOptions() {
  const port = Number(process.env.SMTP_PORT || 465);
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Configuración SMTP incompleta');
  }
  return {
    host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    disableFileAccess: true, disableUrlAccess: true,
  };
}

function isConfigured() {
  if (process.env.SMTP_HOST) {
    try { smtpOptions(); return Boolean(process.env.PASSWORD_RESET_FROM); } catch { return false; }
  }
  return Boolean(process.env.RESEND_API_KEY && process.env.PASSWORD_RESET_FROM);
}

async function send(message) {
  const mail = { from: process.env.PASSWORD_RESET_FROM, ...message };
  if (process.env.SMTP_HOST) {
    const result = await nodemailer.createTransport(smtpOptions()).sendMail(mail);
    if (!result.accepted?.length || result.rejected?.length) throw new Error('SMTP rechazó el destinatario');
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(mail), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('No se pudo enviar el correo de recuperación');
}

async function verify() {
  return nodemailer.createTransport(smtpOptions()).verify();
}

module.exports = { send, isConfigured, smtpOptions, verify };
