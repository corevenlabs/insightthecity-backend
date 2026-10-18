const crypto = require('crypto');
const db = require('../config/db');
const stripe = require('./stripe.service');
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
const hash = value => crypto.createHmac('sha256',process.env.JWT_SECRET).update('membership-launch:'+value).digest('hex');
const emailHash = email => hash(String(email).trim().toLowerCase());
function enabled(){return process.env.MEMBERSHIP_LAUNCH_TEST_ENABLED==='true' && /^sk_test_/.test(process.env.STRIPE_SECRET_KEY||'');}
function available(){if(!enabled())fail('La promoción de prueba no está habilitada.',503);}
async function transaction(fn){const c=await db.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function issue(email){
 available(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Correo inválido');
 return transaction(async c=>{
  await c.query("SELECT pg_advisory_xact_lock(71300300)");
  const existing=(await c.query('SELECT * FROM membership_launch_invitations WHERE email_hash=$1 FOR UPDATE',[emailHash(email)])).rows[0];
  if((await c.query('SELECT id FROM users WHERE LOWER(email)=$1',[String(email).trim().toLowerCase()])).rowCount)fail('La invitación es exclusivamente para usuarios nuevos.',409);
  if(existing?.activated_at || existing?.checkout_id)fail('Esta invitación ya tiene una activación o checkout. No se puede reemplazar.',409);
  if(!existing && (await c.query('SELECT count(*)::int n FROM membership_launch_invitations')).rows[0].n>=300)fail('Los 300 cupos ya están asignados.',409);
  const token=crypto.randomBytes(32).toString('hex');
  const result=await c.query(`INSERT INTO membership_launch_invitations(email_hash,token_hash) VALUES($1,$2) ON CONFLICT(email_hash) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=NOW()+INTERVAL '30 days' RETURNING id`,[emailHash(email),hash(token)]);
  return {id:result.rows[0].id,token};
 });
}
async function lookup(c,token,lock=false){
 if(typeof token!=='string'|| !/^[a-f0-9]{64}$/.test(token))fail('Invitación inválida',404);
 const row=(await c.query(`SELECT * FROM membership_launch_invitations WHERE token_hash=$1${lock?' FOR UPDATE':''}`,[hash(token)])).rows[0];
 if(!row || row.expires_at<=new Date())fail('La invitación venció o no es válida.',404);
 return row;
}
async function preview(token){available();const invite=await lookup(db,token);if(invite.activated_at)fail('Esta invitación ya fue activada.',409);return {resume:Boolean(invite.registered_at)};}
async function register({token,email,name,password,acceptLegal}){
 available();email=String(email||'').trim().toLowerCase();name=String(name||'').trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail('Introduce el correo que recibió la invitación.');
 if(typeof password!=='string'||password.length<8||Buffer.byteLength(password)>72)fail('Usa una contraseña de al menos 8 caracteres y como máximo 72 bytes.');
 if(!name||name.length>120)fail('Introduce tu nombre (máximo 120 caracteres).');
 if(acceptLegal!==true)fail('Debes aceptar los Términos y la Política de privacidad.');
 const bcrypt=require('bcryptjs'),users=require('./users.service'),legal=require('./legal.service');
 const passwordHash=await bcrypt.hash(password,10);
 const result=await transaction(async c=>{
  const invite=await lookup(c,token,true);
  if(invite.email_hash!==emailHash(email))fail('Usa el mismo correo que recibió la invitación.',403);
  if(invite.activated_at)fail('Esta invitación ya fue activada.',409);
  let user=(await c.query('SELECT * FROM users WHERE LOWER(email)=$1',[email])).rows[0];
  if(invite.registered_at){
   if(!user||invite.user_id!==user.id||!user.is_active||!await bcrypt.compare(password,user.password_hash||''))fail('Revisa la contraseña que creaste para esta invitación.',403);
   if(user.stripe_subscription_id)fail('Tu membresía ya fue activada.',409);
  }else{
   if(user)fail('Esta promoción es exclusivamente para usuarios nuevos. Este correo ya tiene una cuenta.',409);
   try{user=(await c.query("INSERT INTO users(name,email,password_hash,language) VALUES($1,$2,$3,'es') RETURNING *",[name,email,passwordHash])).rows[0];}catch(e){if(e.code==='23505')fail('Este correo ya tiene una cuenta.',409);throw e;}
   await legal.recordAcceptance(c,{userId:user.id,language:'es',context:'register',slugs:legal.REGISTER_SLUGS});
   await c.query('UPDATE membership_launch_invitations SET user_id=$2,registered_at=NOW() WHERE id=$1',[invite.id,user.id]);
  }
  return {token:users.signToken(user),user:users.publicUser(user)};
 });
 try{await require('./membership-launch-email.service').sendAccountCreated(result.user,token);}catch{console.error('[launch registration] Account email pending retry.');}
 return result;
}
async function checkout({userId,token,consent,baseUrl}){
 available();if(consent!==true)fail('Debes aceptar el primer cargo y la renovación automática.');
 return transaction(async c=>{
  const invite=await lookup(c,token,true);
  if(!invite.registered_at||invite.user_id!==userId)fail('Crea tu cuenta desde esta invitación para continuar.',403);
  const user=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
  if(!user?.is_active)fail('Cuenta no disponible',403);
  if(invite.email_hash!==emailHash(user.email) || (invite.user_id && invite.user_id!==user.id))fail('Inicia sesión con la cuenta que recibió esta invitación.',403);
  if(invite.activated_at || user.stripe_subscription_id)fail('La promoción es solo para cuentas sin una suscripción previa.',409);
  if(invite.checkout_id){
   const session=await stripe.retrieveCheckoutSession(invite.checkout_id);
   if(session.status==='open')return {checkoutUrl:session.url};
   if(session.status==='complete')fail('Tu activación ya se completó. Abre Mi membresía en la app.',409);
  }
  const plan=await stripe.getPlan();
  if(plan.amountCents!==499 || plan.currency!=='usd' || plan.interval!=='month' || plan.intervalCount!==1)fail('El plan de prueba no coincide con US$4.99 al mes.',409);
  const customerId=await stripe.ensureCustomer(user);
  await c.query('UPDATE users SET stripe_customer_id=$2,autorenew_consent_at=NOW() WHERE id=$1',[user.id,customerId]);
  const notice='30 días gratis. Después se cobrarán US$4.99 al mes automáticamente hasta que canceles. Puedes cancelar antes del primer cargo en Perfil > Mi membresía.';
  await require('./legal.service').recordAcceptance(c,{userId:user.id,language:'es',context:'subscription',slugs:require('./legal.service').SUBSCRIPTION_SLUGS,customerReference:customerId,renewal:{affirmativeConsent:true,amountCents:499,currency:'usd',interval:'month',trialDays:30,invitationId:invite.id,notice,stage:'checkout_requested'}});
  const session=await stripe.createCheckoutSession({user,customerId,baseUrl,appReturnUrl:'itcclub://login',renewalNotice:notice,trialDays:30,invitationId:invite.id,successUrl:`${baseUrl}/membership-activation?session_id={CHECKOUT_SESSION_ID}`,cancelUrl:`${baseUrl}/membership-invitation#${token}`,idempotencyKey:`launch:${invite.id}:${invite.checkout_id||'first'}`});
  await c.query('UPDATE membership_launch_invitations SET user_id=$2,checkout_id=$3 WHERE id=$1',[invite.id,user.id,session.id]);
  return {checkoutUrl:session.url};
 });
}
async function confirm(userId,subscription){
 const id=subscription.metadata?.launch_invitation_id;if(!id)return;
 if(subscription.livemode!==false || !['trialing','active','past_due','canceled','unpaid','paused'].includes(subscription.status))fail('Suscripción de promoción inválida.',409);
 const result=await db.query(`UPDATE membership_launch_invitations SET subscription_id=$3,activated_at=COALESCE(activated_at,NOW()) WHERE id=$1 AND user_id=$2 AND (subscription_id IS NULL OR subscription_id=$3) RETURNING id`,[id,userId,subscription.id]);
 if(!result.rowCount)fail('La suscripción no coincide con la invitación.',409);
}
module.exports={issue,preview,register,checkout,confirm,enabled,emailHash};
