const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const mailer = require('../services/password-reset-mail.service');

test('SMTP usa TLS, autentica y detecta rechazos sin recurrir a Resend', async () => {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'PASSWORD_RESET_FROM'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const createTransport = nodemailer.createTransport;
  let rejected = false;
  try {
    Object.assign(process.env, { SMTP_HOST: 'gvam1027.siteground.biz', SMTP_PORT: '465', SMTP_USER: 'noreply@insightthecity.com', SMTP_PASSWORD: 'test-only', PASSWORD_RESET_FROM: 'ITC Club <noreply@insightthecity.com>' });
    nodemailer.createTransport = options => {
      assert.equal(options.secure, true);
      assert.equal(options.tls.rejectUnauthorized, true);
      assert.equal(options.auth.user, process.env.SMTP_USER);
      assert.equal(options.auth.pass, 'test-only');
      return { verify: async () => true, sendMail: async message => {
        assert.equal(message.from, process.env.PASSWORD_RESET_FROM);
        return rejected ? { accepted: [], rejected: message.to } : { accepted: message.to, rejected: [] };
      } };
    };
    assert.equal(mailer.isConfigured(), true);
    assert.equal(await mailer.verify(), true);
    await mailer.send({ to: ['test@example.com'], text: 'Test' });
    rejected = true;
    await assert.rejects(mailer.send({ to: ['test@example.com'], text: 'Test' }), /rechazó/);
    delete process.env.SMTP_PASSWORD;
    assert.equal(mailer.isConfigured(), false);
    await assert.rejects(mailer.send({ to: ['test@example.com'] }), /incompleta/);
    process.env.SMTP_PASSWORD = 'test-only';
    process.env.SMTP_PORT = '587';
    assert.equal(mailer.smtpOptions().requireTLS, true);
    process.env.SMTP_PORT = 'invalid';
    assert.equal(mailer.isConfigured(), false);
  } finally {
    nodemailer.createTransport = createTransport;
    for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
  }
});
