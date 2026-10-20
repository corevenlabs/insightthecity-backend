const db=require('../config/db'),mail=require('./mailer.service'),billing=require('./membership-billing.service');
const id=value=>typeof value==='string'?value:value?.id;
function subscriptionId(invoice){return id(invoice.parent?.subscription_details?.subscription)||id(invoice.subscription);}
function paymentUrl(value){try{const url=new URL(value);if(url.protocol==='https:'&&['invoice.stripe.com','pay.stripe.com'].includes(url.hostname))return url.href;}catch{}return null;}
function unpaid(invoice){return invoice.status==='open'&&!invoice.paid&&invoice.amount_remaining>0;}
async function handle(event,source){
 const stripe=billing.forUser({stripe_billing_source:source});
 const invoice=await stripe.retrieveInvoice(event.data.object.id),subId=subscriptionId(invoice);
 if(!subId)return;
 const user=(await db.query('SELECT * FROM users WHERE stripe_subscription_id=$1 AND stripe_billing_source=$2 AND is_active=TRUE',[subId,source])).rows[0];
 if(!user||user.stripe_customer_id!==id(invoice.customer))return;
 if(!unpaid(invoice)){
  await db.query('UPDATE membership_payment_alerts SET resolved_at=NOW(),claimed_at=NULL WHERE invoice_id=$1 AND billing_source=$2',[invoice.id,source]);return;
 }
 if(event.type==='invoice.paid')return;
 const kind=event.type==='invoice.payment_action_required'?'action_required':'failed';
 const row=(await db.query(`INSERT INTO membership_payment_alerts(user_id,invoice_id,billing_source,kind) VALUES($1,$2,$3,$4)
 ON CONFLICT(invoice_id,billing_source) DO UPDATE SET kind=EXCLUDED.kind RETURNING id`,[user.id,invoice.id,source,kind])).rows[0];
 await deliver(row.id);
}
async function deliver(alertId){
 const alert=(await db.query(`UPDATE membership_payment_alerts SET claimed_at=NOW(),attempts=attempts+1 WHERE id=$1
 AND sent_at IS NULL AND resolved_at IS NULL AND retry_at<=NOW() AND (claimed_at IS NULL OR claimed_at<NOW()-INTERVAL '10 minutes') RETURNING *`,[alertId])).rows[0];
 if(!alert)return false;
 try{
  const user=(await db.query('SELECT * FROM users WHERE id=$1 AND is_active=TRUE',[alert.user_id])).rows[0];
  if(!user||user.stripe_billing_source!==alert.billing_source)throw Error('Account unavailable');
  const stripe=billing.forUser(user),invoice=await stripe.retrieveInvoice(alert.invoice_id);
  if(user.stripe_subscription_id!==subscriptionId(invoice)||user.stripe_customer_id!==id(invoice.customer))throw Error('Invoice ownership mismatch');
  if(!unpaid(invoice)){await db.query('UPDATE membership_payment_alerts SET resolved_at=NOW(),claimed_at=NULL WHERE id=$1',[alert.id]);return false;}
  const url=paymentUrl(invoice.hosted_invoice_url);if(!url)throw Error('Secure invoice URL unavailable');
  await mail.sendEmail({to:user.email,...require('./membership-payment-failed-email.service').render({user,invoice,url,kind:alert.kind})});
  await db.query('UPDATE membership_payment_alerts SET sent_at=NOW(),claimed_at=NULL WHERE id=$1',[alert.id]);return true;
 }catch{
  await db.query("UPDATE membership_payment_alerts SET claimed_at=NULL,retry_at=NOW()+make_interval(secs=>LEAST(3600,60*power(2,LEAST(attempts,6)))::int) WHERE id=$1",[alert.id]);
  console.error('[payment notice] Delivery pending retry; private values omitted.');return false;
 }
}
async function retry(){
 const rows=(await db.query("SELECT id FROM membership_payment_alerts WHERE sent_at IS NULL AND resolved_at IS NULL AND retry_at<=NOW() AND (claimed_at IS NULL OR claimed_at<NOW()-INTERVAL '10 minutes') ORDER BY retry_at LIMIT 25")).rows;
 let sent=0;for(const row of rows)if(await deliver(row.id))sent++;return {checked:rows.length,sent};
}
module.exports={handle,deliver,retry,paymentUrl,subscriptionId};
