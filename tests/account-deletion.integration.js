const {test,after}=require('node:test');
const assert=require('node:assert/strict');
if(process.env.DB_DATABASE!=='itc_crm_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated test DB only');
const db=require('../config/db');
const fs=require('fs');
const service=require('../services/account-deletion.service');
const stripe=require('../services/stripe.service');
const uploads=require('../services/uploads.service');
const mail=require('../services/password-reset-mail.service');
after(()=>db.end());
test('durable retries survive Stripe and photo failures without premature confirmation',async()=>{
  await db.query(fs.readFileSync('database/schema.sql','utf8'));
  await db.query(fs.readFileSync('database/account-deletion.sql','utf8'));
  const u=(await db.query("INSERT INTO users(email,stripe_subscription_id,subscription_status) VALUES($1,'sub_fake','active') RETURNING id",[`deletion-${Date.now()}@example.test`])).rows[0];
  const originals={cancel:stripe.cancelSubscriptionNow,photos:uploads.deletePrefix,send:mail.send,configured:mail.isConfigured};
  let canceled=0, sent=0;
  try{
    stripe.cancelSubscriptionNow=async()=>{throw Error('Stripe down');};
    mail.isConfigured=()=>true;mail.send=async()=>{sent++;};
    const job=await service.request(u.id);
    assert.equal((await service.request(u.id)).id,job.id);
    await service.processJob(job.id);
    let row=(await db.query('SELECT * FROM account_deletions WHERE id=$1',[job.id])).rows[0];
    assert.equal(row.last_error,'stripe');assert.equal(row.data_done,false);assert.equal(sent,0);
    assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1',[u.id])).rows[0].is_active,false);
    stripe.cancelSubscriptionNow=async()=>{canceled++;};
    uploads.deletePrefix=async()=>{throw Error('Storage down');};
    await db.query('UPDATE account_deletions SET next_attempt_at=NOW() WHERE id=$1',[job.id]);
    await service.processJob(job.id);
    row=(await db.query('SELECT * FROM account_deletions WHERE id=$1',[job.id])).rows[0];
    assert.equal(row.data_done,true);assert.equal(row.photos_done,false);assert.equal(row.status,'pending');assert.equal(sent,0);
    assert.equal((await db.query('SELECT id FROM users WHERE id=$1',[u.id])).rowCount,0);
    uploads.deletePrefix=async prefix=>assert.equal(prefix,`avatars/${u.id}`);
    mail.send=async()=>{throw Error('SMTP down');};
    await db.query('UPDATE account_deletions SET next_attempt_at=NOW() WHERE id=$1',[job.id]);await service.processJob(job.id);
    row=(await db.query('SELECT * FROM account_deletions WHERE id=$1',[job.id])).rows[0];assert.equal(row.photos_done,true);assert.equal(row.last_error,'confirmation');
    mail.send=async()=>{sent++;};
    await db.query('UPDATE account_deletions SET next_attempt_at=NOW() WHERE id=$1',[job.id]);
    await Promise.all([service.processJob(job.id),service.processJob(job.id)]);
    row=(await db.query('SELECT * FROM account_deletions WHERE id=$1',[job.id])).rows[0];
    assert.equal(row.status,'completed');assert.equal(row.email,null);assert.equal(row.subscription_id,null);assert.equal(row.user_id,null);assert.equal(canceled,1);assert.equal(sent,1);
    await service.processJob(job.id);assert.equal(sent,1);
    await db.query('DELETE FROM account_deletions WHERE id=$1',[job.id]);
  }finally{stripe.cancelSubscriptionNow=originals.cancel;uploads.deletePrefix=originals.photos;mail.send=originals.send;mail.isConfigured=originals.configured;await db.query('DELETE FROM account_deletions WHERE user_id=$1',[u.id]);await db.query('DELETE FROM users WHERE id=$1',[u.id]);}
});
test('retention removes old chats and redacts sent emails without losing dedupe or pending mail',async()=>{
 await db.query(fs.readFileSync('database/partner-crm.sql','utf8'));
 const chats=(await db.query("INSERT INTO chat_messages(user_id,role,message,created_at) VALUES(NULL,'user','retention-old',NOW()-INTERVAL '91 days'),(NULL,'user','retention-recent',NOW()) RETURNING id")).rows;
 const mails=(await db.query(`INSERT INTO partner_mail(dedupe_key,recipient,message,status,created_at,sent_at) VALUES
 ($1,'old@example.test','{"text":"private","attachments":[{"content":"private"}]}','sent',NOW()-INTERVAL '100 days',NOW()-INTERVAL '91 days'),
 ($2,'pending@example.test','{"text":"retry"}','pending',NOW()-INTERVAL '100 days',NULL),
 ($3,'recent@example.test','{"text":"recent"}','sent',NOW()-INTERVAL '100 days',NOW()) RETURNING id,dedupe_key`,['retention-old-'+Date.now(),'retention-pending-'+Date.now(),'retention-recent-'+Date.now()])).rows;
 try{
  await require('../services/data-retention.service').sweep();
  assert.equal((await db.query('SELECT id FROM chat_messages WHERE id=$1',[chats[0].id])).rowCount,0);
  assert.equal((await db.query('SELECT id FROM chat_messages WHERE id=$1',[chats[1].id])).rowCount,1);
  const old=(await db.query('SELECT * FROM partner_mail WHERE id=$1',[mails[0].id])).rows[0];
  assert.equal(old.recipient,'');assert.deepEqual(old.message,{});assert.equal(old.dedupe_key,mails[0].dedupe_key);
  assert.equal((await db.query('SELECT recipient FROM partner_mail WHERE id=$1',[mails[1].id])).rows[0].recipient,'pending@example.test');
  assert.equal((await db.query('SELECT recipient FROM partner_mail WHERE id=$1',[mails[2].id])).rows[0].recipient,'recent@example.test');
 }finally{await db.query('DELETE FROM chat_messages WHERE id=ANY($1::int[])',[chats.map(x=>x.id)]);await db.query('DELETE FROM partner_mail WHERE id=ANY($1::uuid[])',[mails.map(x=>x.id)]);}
});
