const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const service = require('../services/password-reset.service');

test('recuperación envía código, rechaza uno incorrecto y consume el correcto una sola vez', async () => {
  const originalQuery = db.query;
  const originalConnect = db.connect;
  const originalFetch = global.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.PASSWORD_RESET_FROM;
  const originalSecret = process.env.JWT_SECRET;
  const user = { id: 7, email: 'jose@example.com', language: 'es', is_active: true };
  let reset = null;
  let passwordHash = null;
  let sentCode = null;
  try {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.PASSWORD_RESET_FROM = 'ITC Club <test@example.com>';
    process.env.JWT_SECRET = 'test-secret';
    global.fetch = async (_url, request) => {
      sentCode = JSON.parse(request.body).text.match(/\b\d{8}\b/)[0];
      return { ok: true };
    };
    db.query = async (sql, values) => {
      if (sql.includes('SELECT id, email, language')) return { rows: [user] };
      if (sql.includes('INSERT INTO password_reset_codes')) {
        reset = { user_id: values[0], code_hash: values[1], expires_at: new Date(Date.now() + 900000), attempts: 0 };
        return { rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    };
    db.connect = async () => ({
      query: async (sql, values) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
        if (sql.includes('SELECT r.user_id')) return { rows: reset ? [reset] : [] };
        if (sql.includes('SET attempts = attempts + 1')) { reset.attempts++; return {}; }
        if (sql.includes('UPDATE users SET password_hash')) { passwordHash = values[0]; return {}; }
        if (sql.includes('DELETE FROM password_reset_codes')) { reset = null; return {}; }
        throw new Error(`Unexpected transaction query: ${sql}`);
      },
      release() {},
    });

    await service.requestReset(user.email);
    assert.match(sentCode, /^\d{8}$/);
    assert.equal(await service.resetPassword(user.email, '99999999' === sentCode ? '88888888' : '99999999', 'new-password'), false);
    assert.equal(reset.attempts, 1);
    assert.equal(await service.resetPassword(user.email, sentCode, 'new-password'), true);
    assert.equal(await bcrypt.compare('new-password', passwordHash), true);
    assert.equal(await service.resetPassword(user.email, sentCode, 'another-password'), false);
  } finally {
    db.query = originalQuery;
    db.connect = originalConnect;
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ RESEND_API_KEY: originalKey, PASSWORD_RESET_FROM: originalFrom, JWT_SECRET: originalSecret })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
