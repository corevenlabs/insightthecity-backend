const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
if (process.env.DB_DATABASE !== 'itc_crm_test' || process.env.DB_HOST !== '127.0.0.1') throw Error('Isolated local DB only');
process.env.JWT_SECRET = 'google-deletion-local-test';
const db = require('../config/db');
const users = require('../services/users.service');
const deletion = require('../services/account-deletion.service');
const originalProcess = deletion.processJob;
let processed = 0;
deletion.processJob = async () => { processed++; };
after(async () => { deletion.processJob = originalProcess; await db.end(); });

test('Google deletion uses the current session, confirmation and the existing durable deletion pipeline', async () => {
  for (const file of ['schema.sql', 'security-hardening.sql', 'account-deletion.sql', 'google-auth.sql', 'apple-auth.sql']) {
    await db.query(fs.readFileSync(`database/${file}`, 'utf8'));
  }
  const create = async (google) => {
    const tag = crypto.randomUUID();
    const user = (await db.query("INSERT INTO users(email,password_hash,stripe_subscription_id,subscription_status,is_premium) VALUES($1,NULL,$2,'active',TRUE) RETURNING *", [`${tag}@example.com`, `sub_test_${tag}`])).rows[0];
    if (google) await db.query('INSERT INTO google_auth_identities(subject,user_id) VALUES($1,$2)', [tag, user.id]);
    return user;
  };
  const u = await create(true), other = await create(false);
  const express = require('express'), app = express();
  app.use(express.json());
  app.use('/users', require('../routes/users.routes'));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = async (path, token, body) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/users${path}`, {method: body ? 'POST' : 'GET', headers:{'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})}, body: body && JSON.stringify(body)});
    return {status:r.status, body:await r.json()};
  };
  try {
    const token = users.signToken(u), otherToken = users.signToken(other);
    assert.equal((await request('/google/delete', null, {confirm:true})).status, 401);
    assert.equal((await request('/me/deletion-method', token)).body.method, 'google');
    assert.equal((await request('/google/delete', token, {})).status, 400);
    assert.equal((await request('/google/delete', token, {confirm:'true'})).status, 400);
    assert.equal((await request('/google/delete', otherToken, {confirm:true, user_id:u.id})).status, 403);
    assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[u.id])).rows[0].is_active, true);
    const result = await request('/google/delete', token, {confirm:true, user_id:other.id});
    assert.equal(result.status, 202);
    assert.equal(result.body.success, true);
    assert.equal(processed, 1);
    assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[u.id])).rows[0].is_active, false);
    assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[other.id])).rows[0].is_active, true);
    const job = (await db.query('SELECT * FROM account_deletions WHERE user_id=$1',[u.id])).rows[0];
    assert.equal(job.subscription_id, u.stripe_subscription_id);
    assert.equal(job.stripe_done, false);
    assert.equal(job.status, 'pending');
    assert.equal((await request('/google/delete', token, {confirm:true})).status, 403);
    assert.equal((await db.query('SELECT COUNT(*) FROM account_deletions WHERE user_id=$1',[u.id])).rows[0].count, '1');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await db.query('DELETE FROM account_deletions WHERE user_id=ANY($1::int[])', [[u.id, other.id]]);
    await db.query('DELETE FROM users WHERE id=ANY($1::int[])', [[u.id, other.id]]);
  }
});
