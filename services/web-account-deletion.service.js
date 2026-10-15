const db=require('../config/db');
const crypto=require('crypto');
const mail=require('./password-reset-mail.service');
const deletion=require('./account-deletion.service');
const digest=value=>crypto.createHmac('sha256',process.env.JWT_SECRET).update(`web-account-deletion:${value}`).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
async function requestCode(email,language='es'){
 language=['es','en','pt'].includes(language)?language:'es';
 if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email))fail('Correo inválido');
 if(!mail.isConfigured())fail('El correo no está disponible. Contacta a soporte.',503);
 const generic=crypto.randomUUID();
 const user=(await db.query("SELECT id,email FROM users WHERE LOWER(email)=$1 AND NOT EXISTS (SELECT 1 FROM account_deletions WHERE user_id=users.id AND status='pending')",[email.trim().toLowerCase()])).rows[0];
 if(!user)return {challenge:generic};
 const code=String(crypto.randomInt(100000000)).padStart(8,'0');
 const saved=(await db.query(`INSERT INTO account_deletion_challenges(user_id,id,code_hash,expires_at,language)
 VALUES($1,$2,$3,NOW()+INTERVAL '15 minutes',$4) ON CONFLICT(user_id) DO UPDATE
 SET language=EXCLUDED.language,id=EXCLUDED.id,code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,attempts=0,requested_at=NOW(),proof_hash=NULL,proof_expires_at=NULL
 WHERE account_deletion_challenges.requested_at<NOW()-INTERVAL '60 seconds' RETURNING id`,[user.id,generic,digest(`${generic}:${code}`),language])).rows[0];
 if(saved){
  try{await mail.send({to:[user.email],...require('./account-deletion-email').render(language,'code',{code})});}
  catch{await db.query('DELETE FROM account_deletion_challenges WHERE id=$1',[generic]);console.error('[deletion code] MAIL_SEND_FAILED');}
 }
 return {challenge:generic};
}
async function verifyCode(challenge,code){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(challenge||'')||!/^\d{8}$/.test(code||''))fail('Código inválido o vencido');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  const row=(await c.query('SELECT * FROM account_deletion_challenges WHERE id=$1 FOR UPDATE',[challenge])).rows[0];
  if(!row||!row.code_hash||row.attempts>=5||new Date(row.expires_at)<=new Date()){await c.query('COMMIT');return null;}
  const equal=crypto.timingSafeEqual(Buffer.from(row.code_hash,'hex'),Buffer.from(digest(`${challenge}:${code}`),'hex'));
  if(!equal){await c.query('UPDATE account_deletion_challenges SET attempts=attempts+1 WHERE id=$1',[challenge]);await c.query('COMMIT');return null;}
  const proof=crypto.randomBytes(32).toString('hex');
  await c.query("UPDATE account_deletion_challenges SET code_hash=NULL,proof_hash=$2,proof_expires_at=NOW()+INTERVAL '5 minutes' WHERE id=$1",[challenge,digest(proof)]);
  await c.query('COMMIT');return {proof};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function confirm(proof,accept){
 if(accept!==true||!/^\w{64}$/.test(proof||''))fail('Confirma la eliminación y verifica tu correo');
 const c=await db.connect();let job;
 try{
  await c.query('BEGIN');
  // Lock the user before the challenge, matching the account deletion lock order.
  const candidate=(await c.query('SELECT user_id FROM account_deletion_challenges WHERE proof_hash=$1',[digest(proof)])).rows[0];
  if(!candidate){await c.query('ROLLBACK');return null;}
  const user=(await c.query('SELECT id,is_active FROM users WHERE id=$1 FOR UPDATE',[candidate.user_id])).rows[0];
  const row=(await c.query('SELECT * FROM account_deletion_challenges WHERE proof_hash=$1 FOR UPDATE',[digest(proof)])).rows[0];
  if(!user||!row||new Date(row.proof_expires_at)<=new Date()){await c.query('ROLLBACK');return null;}
  job=await deletion.request(user.id,c);
  await c.query('UPDATE account_deletions SET language=$2 WHERE id=$1',[job.id,row.language]);
  await c.query('DELETE FROM account_deletion_challenges WHERE user_id=$1',[user.id]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 // Persisted request survives provider failures; don't falsely reject an accepted request.
 try{await deletion.processJob(job.id);}catch{console.error('[web deletion] REQUEST_QUEUED');}
 return {requested:true};
}
module.exports={requestCode,verifyCode,confirm};
