const {test,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
if(process.env.DB_DATABASE!=='itc_crm_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated local database only');
process.env.JWT_SECRET='password-change-local-test';
const db=require('../config/db'),mail=require('../services/password-reset-mail.service');
const service=require('../services/password-reset.service'),notices=require('../services/password-change-notification.service');
const originalSend=mail.send,originalConfigured=mail.isConfigured;
let code,failNotice=false;const messages=[];
mail.isConfigured=()=>true;
mail.send=async message=>{
  if(message.subject==='Tu código de recuperación ITC Club'){code=message.text.match(/\b\d{8}\b/)[0];return;}
  if(failNotice)throw Object.assign(Error('simulated SMTP failure'),{code:'ETIMEDOUT'});
  messages.push(message);
};
after(async()=>{mail.send=originalSend;mail.isConfigured=originalConfigured;await db.end();});
test('successful password reset persists one alert, preserves the password on SMTP failure and retries without duplicate successful delivery',async()=>{
  await db.query(fs.readFileSync('database/password-change-notifications.sql','utf8'));
  await db.query(fs.readFileSync('database/password-change-notifications.sql','utf8'));
  const user=(await db.query("INSERT INTO users(email,language) VALUES($1,'es') RETURNING *",[`${randomUUID()}@example.com`])).rows[0];
  try{
    await service.requestReset(user.email);
    assert.ok(code);
    assert.equal(await service.resetPassword(user.email,code==='99999999'?'88888888':'99999999','new-password-secret'),false);
    assert.equal((await db.query('SELECT 1 FROM password_change_notifications WHERE user_id=$1',[user.id])).rowCount,0);
    failNotice=true;
    assert.equal(await service.resetPassword(user.email,code,'new-password-secret'),true);
    const pending=(await db.query('SELECT * FROM password_change_notifications WHERE user_id=$1',[user.id])).rows[0];
    assert.equal(pending.status,'pending');assert.equal(pending.attempts,1);
    assert.equal((await db.query('SELECT session_version FROM users WHERE id=$1',[user.id])).rows[0].session_version,1);
    assert.equal(await service.resetPassword(user.email,code,'another-password'),false);
    failNotice=false;
    await db.query('UPDATE password_change_notifications SET next_attempt_at=NOW() WHERE id=$1',[pending.id]);
    await notices.deliver(pending.id);
    await notices.deliver(pending.id);
    assert.equal(messages.length,1);
    assert.deepEqual(messages[0].to,[user.email]);
    assert.match(messages[0].subject,/contraseña fue actualizada/);
    assert.ok(!messages[0].text.includes(code));
    assert.ok(!messages[0].html.includes('new-password-secret'));
    assert.equal((await db.query('SELECT status FROM password_change_notifications WHERE id=$1',[pending.id])).rows[0].status,'sent');
  }finally{await db.query('DELETE FROM users WHERE id=$1',[user.id]);}
});
