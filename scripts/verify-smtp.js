require('dotenv').config({ path: '.env.local', quiet: true });
const mailer = require('../services/password-reset-mail.service');

(async () => {
  await mailer.verify();
  console.log('Conexión TLS y autenticación SMTP correctas.');
  const recipient = process.argv[2];
  if (recipient) {
    await mailer.send({ to: [recipient], subject: 'Prueba de correo ITC Club', text: 'La conexión de ITC Club con SiteGround funciona. Este mensaje es una prueba y no cambia ninguna contraseña.' });
    console.log('Servidor SMTP aceptó el correo de prueba. Confirma su recepción en el buzón.');
  }
})().catch((error) => {
  console.error('Verificación SMTP fallida:', error.code || 'SMTP_ERROR');
  process.exitCode = 1;
});
