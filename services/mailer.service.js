// Todos los correos transaccionales usan el transporte configurado (SMTP o Resend).
const transport = require('./password-reset-mail.service');

function isConfigured() { return transport.isConfigured(); }

async function sendEmail({ to, subject, text }) {
  if (!isConfigured()) throw new Error('El envío de correos no está configurado');
  await transport.send({ from: process.env.EMAIL_FROM || process.env.PASSWORD_RESET_FROM, to: [to], subject, text });
}

module.exports = { isConfigured, sendEmail };
