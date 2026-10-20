// Single-page invitation checkout. Card details go directly from Stripe Elements to Stripe.
const db=require('../config/db'),stripe=require('./membership-campaign-stripe.service'),launch=require('./membership-launch.service');
const mode=require('./membership-mode.service');
const NOTICE='30 días gratis. Después se cobrarán US$4.99 al mes automáticamente hasta que canceles. Puedes cancelar antes del primer cargo en Perfil > Mi membresía.';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
function publishableKey(){const key=mode.publishableKey();if(!mode.configured()||!new RegExp(`^pk_${mode.live()?'live':'test'}_[A-Za-z0-9]+$`).test(key))fail('La activación está temporalmente no disponible. Inténtalo más tarde.',503);return key;}
async function transaction(fn){const c=await db.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function owner(c,userId,token){
 const invite=await launch.lookup(c,token,true);
 if(!invite.registered_at||invite.user_id!==userId)fail('Crea tu cuenta desde esta invitación para continuar.',403);
 const user=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
 if(!user?.is_active||invite.email_hash!==launch.emailHash(user.email))fail('Cuenta no disponible.',403);
 return {invite,user};
}
async function prepare({userId,token,acceptLegal,consent}){
 launch.available();if(require('./membership-payment-link.service').enabled())fail('Continúa con el checkout de Stripe de tu invitación.',409);await mode.requirePublishedLegal();publishableKey();if(acceptLegal!==true||consent!==true)fail('Debes aceptar los términos, la privacidad y la renovación automática.');
 return transaction(async c=>{
  const {invite,user}=await owner(c,userId,token);
  if(invite.activated_at||user.stripe_subscription_id)fail('Tu membresía ya fue activada.',409);
  const plan=await stripe.getPlan();if(plan.amountCents!==499||plan.currency!=='usd'||plan.interval!=='month'||plan.intervalCount!==1)fail('El plan no coincide con US$4.99 al mes.',409);
  // An old hosted checkout must not remain usable alongside the new card form.
  if(invite.checkout_id){const old=await stripe.retrieveCheckoutSession(invite.checkout_id);if(old.status==='complete')fail('Tu activación ya se completó. Consulta Mi membresía.',409);if(old.status==='open')await stripe.expireCheckoutSession(old.id);}
  const customerId=await stripe.ensureCustomer(user,`launch-customer:${user.id}`);
  await c.query("UPDATE users SET stripe_customer_id=$2,stripe_billing_source='campaign',autorenew_consent_at=NOW() WHERE id=$1",[user.id,customerId]);
  if(invite.setup_intent_id){const setup=await stripe.retrieveLaunchSetup(invite.setup_intent_id);if(!mode.matches(setup)||setup.customer!==customerId||setup.metadata?.user_id!==String(userId)||setup.metadata?.launch_invitation_id!==invite.id)fail('La tarjeta no coincide con tu activación.',409);if(setup.status!=='canceled')return {clientSecret:setup.client_secret,setupStatus:setup.status};}
  const legal=require('./legal.service');
  await legal.recordAcceptance(c,{userId:user.id,language:'es',context:'subscription',slugs:legal.SUBSCRIPTION_SLUGS,customerReference:customerId,renewal:{affirmativeConsent:true,amountCents:499,currency:'usd',interval:'month',trialDays:30,invitationId:invite.id,notice:NOTICE,stage:'card_setup_requested'}});
  const setup=await stripe.createLaunchSetup({customerId,userId:user.id,invitationId:invite.id,key:`launch-setup:${invite.id}:${invite.setup_intent_id||'first'}`});
  await c.query('UPDATE membership_launch_invitations SET setup_intent_id=$2 WHERE id=$1',[invite.id,setup.id]);
  return {clientSecret:setup.client_secret,setupStatus:setup.status};
 });
}
async function complete({userId,token}){
 launch.available();
 const sub=await transaction(async c=>{
  const {invite,user}=await owner(c,userId,token);
  if(invite.subscription_id){const existing=await stripe.retrieveSubscription(invite.subscription_id);if(!mode.matches(existing)||existing.metadata?.user_id!==String(userId)||existing.metadata?.launch_invitation_id!==invite.id||String(existing.customer?.id||existing.customer)!==user.stripe_customer_id)fail('La suscripción no coincide con tu cuenta.',409);return existing;}
  if(user.stripe_subscription_id)fail('Esta cuenta ya tiene una suscripción.',409);
  if(!invite.setup_intent_id)fail('Completa primero los datos de tu tarjeta.',409);
  const setup=await stripe.retrieveLaunchSetup(invite.setup_intent_id);
  if(setup.status!=='succeeded')fail('La tarjeta aún no está confirmada. Completa la verificación del banco.',409);
  if(!mode.matches(setup)||setup.customer!==user.stripe_customer_id||setup.metadata?.user_id!==String(userId)||setup.metadata?.launch_invitation_id!==invite.id||!setup.payment_method)fail('La tarjeta no coincide con tu activación.',409);
  const subscription=await stripe.createLaunchSubscription({userId,customerId:user.stripe_customer_id,paymentMethod:setup.payment_method,invitationId:invite.id,key:`launch-subscription:${invite.id}`});
  await c.query('UPDATE membership_launch_invitations SET subscription_id=$2 WHERE id=$1',[invite.id,subscription.id]);
  return subscription;
 });
 const subscriptions=require('./subscription.service');
 const user=await subscriptions.applySubscription(userId,sub);
 if(!user?.is_premium||user.subscription_status!=='trialing')fail('Consulta el estado de tu membresía desde la app.',409);
 try{await subscriptions.sendConfirmationOnce(user);}catch{console.error('[launch] Welcome email pending retry.');}
 return {name:user.name,email:user.email,active:true};
}
async function resend({userId,token}){
 launch.available();
 const user=await transaction(async c=>{
  const {invite,user}=await owner(c,userId,token);
  if(!invite.activated_at||!user.is_premium||invite.subscription_id!==user.stripe_subscription_id)fail('La membresía todavía no está activa.',409);
  if(invite.welcome_resend_after&&new Date(invite.welcome_resend_after)>new Date())fail('Espera 60 segundos antes de volver a solicitarlo.',429);
  // Also bound manual resends per day through the route's persistent rate limiter.
  await c.query("UPDATE membership_launch_invitations SET welcome_resend_after=NOW()+INTERVAL '60 seconds' WHERE id=$1",[invite.id]);
  await c.query("UPDATE users SET subscription_confirmation_sent_for=NULL,subscription_confirmation_claimed_at=NULL,subscription_confirmation_retry_at=NULL WHERE id=$1 AND (subscription_confirmation_claimed_at IS NULL OR subscription_confirmation_claimed_at<NOW()-INTERVAL '10 minutes')",[userId]);
  return user;
 });
 const sent=await require('./subscription.service').sendConfirmationOnce(user);
 return {sent:Boolean(sent),message:sent?'Correo reenviado. Revisa también la carpeta de spam.':'Tu membresía sigue activa. El envío está pendiente; volveremos a intentarlo automáticamente.'};
}
module.exports={prepare,complete,resend,publishableKey,NOTICE};
