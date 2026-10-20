const db=require('../config/db'),launch=require('./membership-launch.service'),mode=require('./membership-mode.service'),mailer=require('./password-reset-mail.service');
// Explicitly selected recipients only. This function is never called during deployment.
async function send(email){
 launch.available();await mode.requirePublishedLegal();
 email=String(email||'').trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Selecciona un correo válido de la lista de invitados.');
 if(!mailer.isConfigured())throw Error('Correo no configurado.');
 const base=process.env.PUBLIC_BASE_URL;
 if(!base||!base.startsWith('https://'))throw Error('Configura PUBLIC_BASE_URL con HTTPS.');
 const c=await db.connect();
 const lock='membership-invitation-delivery:'+launch.emailHash(email);
 try{
  await c.query('SELECT pg_advisory_lock(hashtext($1))',[lock]);
  const existing=(await c.query('SELECT invitation_sent_at FROM membership_launch_invitations WHERE email_hash=$1',[launch.emailHash(email)])).rows[0];
  if(existing?.invitation_sent_at)return {sent:false,alreadySent:true};
  const invitation=await launch.issue(email,c);
  const url=base.replace(/\/$/,'')+'/membership-invitation#'+invitation.token;
  await mailer.send({to:email,...require('./membership-invitation-email.service').render({base:base.replace(/\/$/,''),url,sandbox:!mode.live(),hosted:require('./membership-payment-link.service').enabled()})});
  await c.query('UPDATE membership_launch_invitations SET invitation_sent_at=NOW() WHERE id=$1',[invitation.id]);
  return {sent:true,alreadySent:false};
 }finally{try{await c.query('SELECT pg_advisory_unlock(hashtext($1))',[lock]);}finally{c.release();}}
}
module.exports={send};
