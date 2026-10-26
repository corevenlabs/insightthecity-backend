const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const users = require('../services/users.service');
const controller = require('../controllers/users.controller');
test('login distinguishes unknown email, incorrect password, and social accounts without changing successful login', async () => {
  const original = db.query, secret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'login-notice-test';
  const hash = await bcrypt.hash('correct-password', 4);
  let user = null;
  db.query = async () => ({rows:user ? [user] : []});
  const request = async password => {
    let status=200, body;
    await controller.login({body:{email:'test@example.com',password}}, {status(v){status=v;return this;},json(v){body=v;}}, error=>{throw error;});
    return {status,body};
  };
  try {
    assert.equal((await request('wrong-password')).body.code,'ACCOUNT_NOT_FOUND');
    user={id:1,email:'test@example.com',password_hash:hash,is_active:true};
    assert.equal((await request('wrong-password')).body.code,'INVALID_PASSWORD');
    assert.equal((await request('correct-password')).body.success,true);
    user.password_hash=null;
    assert.equal((await request('wrong-password')).body.code,'LOGIN_PROVIDER_REQUIRED');
    user.password_hash=hash;user.is_active=false;
    const inactive=await request('correct-password');
    assert.equal(inactive.status,403);
    assert.notEqual(inactive.body.code,'ACCOUNT_NOT_FOUND');
  } finally { db.query=original; if(secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=secret; }
});

test('password change emails use existing brand typography in all languages without secrets or a recovery instruction', () => {
  const email = require('../services/password-changed-email');
  const brand = require('../services/brand-typography');
  for (const language of ['es','en','pt']) {
    const message = brand.email(email.render(language));
    assert.match(message.html,new RegExp(`<html lang="${language}">`));
    assert.match(message.html,/itc-club-logo-v1.png/);
    assert.match(message.html,/data-itc-typography/);
    assert.doesNotMatch(message.html,/\/undefined|00000000|RECUPERACIÓN/);
    assert.match(message.html,/#FDDD56/);
  }
});
