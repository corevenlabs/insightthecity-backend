// Hosted Stripe checkout for the private campaign. A bare public link cannot identify an ITC account.
const crypto=require('crypto'),db=require('../config/db'),stripe=require('./membership-campaign-stripe.service'),mode=require('./membership-mode.service'),launch=require('./membership-launch.service');
const URL='https://buy.stripe.com/00w14n4bs1yPdFjgUl8Vi05',LINK_ID='plink_1USQAsI4w6DUYfoWkQ1TzQBT',PRICE_ID='price_1USQAsI4w6DUYfoWzFKl09ib';
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
const ident=value=>typeof value==='string'?value:value?.id;
function enabled(){return mode.live()&&process.env.MEMBERSHIP_CAMPAIGN_CHECKOUT==='payment_link';}
function isSession(session){return enabled()&&ident(session.payment_link)===LINK_ID;}
function signature(invite){return crypto.createHmac('sha256',process.env.JWT_SECRET).update(`membership-link:${invite.id}:${invite.user_id}:${invite.token_hash}`).digest('hex').slice(0,32);}
function reference(invite){return `itcm_${invite.id}_${invite.user_id}_${signature(invite)}`;}
function validReference(value,invite){const expected=reference(invite);return typeof value==='string'&&value.length===expected.length&&crypto.timingSafeEqual(Buffer.from(value),Buffer.from(expected));}
async function validateLink(){
 const link=await stripe.retrievePaymentLink(LINK_ID),items=await stripe.listPaymentLinkItems(LINK_ID);
 const price=items.data?.[0]?.price;
 if(!link.active||!link.livemode||link.url!==URL||link.subscription_data?.trial_period_days!==30||link.payment_method_collection!=='always'||items.data.length!==1||items.data[0].quantity!==1||price?.id!==PRICE_ID||price.unit_amount!==499||price.currency!=='usd'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1)fail('El enlace de la campaña no coincide con 30 días gratis y US$4.99 al mes.',503);
 return link;
}
async function checkout({userId,token,acceptLegal,consent}){
 launch.available();if(!enabled())fail('Checkout no disponible.',503);
 if(acceptLegal!==true||consent!==true)fail('Acepta los términos, privacidad y renovación automática.',400);
 await mode.requirePublishedLegal();await validateLink();
 const c=await db.connect();
 try{
  await c.query('BEGIN');const invite=await launch.lookup(c,token,true);
  const user=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
  if(!user?.is_active||invite.user_id!==userId||!invite.registered_at||invite.email_hash!==launch.emailHash(user.email))fail('Crea tu cuenta desde esta invitación.',403);
  if(invite.activated_at||invite.subscription_id||user.stripe_subscription_id)fail('Tu membresía ya está activada.');
  if(invite.setup_intent_id||invite.checkout_id)fail('Continúa el proceso original de tu invitación.');
  const legal=require('./legal.service');
  await legal.recordAcceptance(c,{userId,language:'es',context:'subscription',slugs:legal.SUBSCRIPTION_SLUGS,renewal:{affirmativeConsent:true,amountCents:499,currency:'usd',interval:'month',trialDays:30,invitationId:invite.id,notice:require('./membership-launch-payment.service').NOTICE,stage:'payment_link_requested'}});
  await c.query("UPDATE users SET stripe_billing_source='campaign',autorenew_consent_at=NOW() WHERE id=$1",[userId]);
  const url=new global.URL(URL);url.searchParams.set('client_reference_id',reference(invite));url.searchParams.set('locked_prefilled_email',user.email);
  await c.query('COMMIT');return {checkoutUrl:url.href};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function confirmSession(sessionId){
 const session=await stripe.retrieveCheckoutSession(sessionId,{expand:['subscription','line_items']});
 if(!isSession(session)||session.mode!=='subscription'||session.status!=='complete'||session.livemode!==true||session.amount_total!==0||session.payment_status!=='no_payment_required')fail('Activación de campaña no confirmada.');
 const match=/^itcm_([a-f0-9-]{36})_([0-9]+)_[a-f0-9]{32}$/.exec(session.client_reference_id||'');if(!match)fail('La sesión no incluye una invitación válida.',403);
 let sub=typeof session.subscription==='string'?await stripe.retrieveSubscription(session.subscription):session.subscription;
 const price=sub?.items?.data?.[0]?.price;
 if(sub?.livemode!==true||sub.status!=='trialing'||sub.trial_end-sub.trial_start!==30*86400||!sub.default_payment_method||sub.collection_method!=='charge_automatically'||ident(sub.customer)!==ident(session.customer)||sub.items.data.length!==1||price?.id!==PRICE_ID||price.unit_amount!==499||price.currency!=='usd'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1)fail('La suscripción no coincide con la promoción.');
 const c=await db.connect();let user,invite,duplicate=false;
 try{
  await c.query('BEGIN');invite=(await c.query('SELECT * FROM membership_launch_invitations WHERE id=$1 FOR UPDATE',[match[1]])).rows[0];
  if(!invite||!invite.livemode||!validReference(session.client_reference_id,invite))fail('Invitación inválida.',403);
  user=(await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[invite.user_id])).rows[0];
  if(!user?.is_active||invite.email_hash!==launch.emailHash(user.email)||launch.emailHash(session.customer_details?.email||'')!==invite.email_hash)fail('El correo no corresponde a la invitación.',403);
  if(invite.subscription_id&&invite.subscription_id!==sub.id)duplicate=true;
  else{
   if(!invite.subscription_id&&new Date(invite.expires_at)<=new Date())fail('La invitación venció.');
   if(user.stripe_subscription_id&&user.stripe_subscription_id!==sub.id)fail('La cuenta ya tiene otra suscripción.');
   await c.query('UPDATE membership_launch_invitations SET subscription_id=$2,checkout_id=$3 WHERE id=$1',[invite.id,sub.id,session.id]);
   await c.query("UPDATE users SET stripe_customer_id=$2,stripe_billing_source='campaign' WHERE id=$1",[user.id,ident(session.customer)]);
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 if(duplicate){await stripe.cancelDuplicateTrial(sub.id);return user;}
 // Persist linkage on Stripe so renewal/failure/cancellation events can identify this account.
 sub=await stripe.linkLaunchSubscription(sub.id,{...sub.metadata,user_id:String(user.id),launch_invitation_id:invite.id});
 const subscriptions=require('./subscription.service');
 const result=await subscriptions.applySubscription(user.id,sub);
 await subscriptions.sendConfirmationOnce(result);return result;
}
module.exports={URL,LINK_ID,PRICE_ID,enabled,isSession,reference,validReference,validateLink,checkout,confirmSession};
