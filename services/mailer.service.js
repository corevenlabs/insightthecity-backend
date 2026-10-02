// Envío de correos transaccionales con Resend (mismo proveedor que la recuperación de contraseña).

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && (process.env.EMAIL_FROM || process.env.PASSWORD_RESET_FROM));
}

async function sendEmail({ to, subject, text }) {
  if (!isConfigured()) throw new Error('El envío de correos no está configurado (RESEND_API_KEY / EMAIL_FROM)');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || process.env.PASSWORD_RESET_FROM,
      to: [to],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Resend respondió ${response.status}`);
}

module.exports = { isConfigured, sendEmail };
