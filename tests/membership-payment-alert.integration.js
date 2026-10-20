const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
if(process.env.DB_DATABASE!=='itc_crm_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated database only');
const db=require('../config/db'),service=require('../services/membership-payment-alert.service'),mail=require('../services/mailer.service');
after(()=>db.end());
test('failed invoice notices are owned, isolated, deduplicated, retried and skipped after payment',async t=>{
 for(const file of ['schema.sql','membership-payment-alerts.sql'])await db.query(fs.readFileSync('database/'+file,'utf8'));
 const user=(await db.query("INSERT INTO users(email,name,stripe_customer_id,stripe_subscription_id,stripe_billing_source) VALUES('payment-alert@example.test','Rafa','cus_alert','sub_alert','campaign') RETURNING *")).rows[0];
 const campaign=require('../services/membership-campaign-stripe.service'),normal=require('../services/stripe.service');
 const old={retrieve:campaign.retrieveInvoice,normal:normal.retrieveInvoice,send:mail.sendEmail};let sends=0,fail=false;
 let invoice={id:'in_notice',parent:{subscription_details:{subscription:'sub_alert'}},customer:'cus_alert',status:'open',amount_remaining:499,currency:'usd',hosted_invoice_url:'https://invoice.stripe.com/i/example'};
 campaign.retrieveInvoice=async()=>invoice;normal.retrieveInvoice=async()=>invoice;mail.sendEmail=async message=>{if(fail)throw Error('SMTP down');sends++;assert.equal(message.to,user.email);assert.match(message.html,/membership-payment-failed-es-v1/);};
 const event={type:'invoice.payment_failed',data:{object:{id:'in_notice'}}};
 try{
 await t.test('normal destination cannot notify a campaign account',async()=>{await service.handle(event,'normal');assert.equal(sends,0);});
 await t.test('foreign customer is ignored',async()=>{invoice.customer='cus_foreign';await service.handle(event,'campaign');assert.equal(sends,0);invoice.customer='cus_alert';});
 await t.test('replayed events produce one notice per invoice',async()=>{await Promise.all([service.handle(event,'campaign'),service.handle(event,'campaign')]);assert.equal(sends,1);});
 await t.test('SMTP failure remains durable; retry sends after recovery',async()=>{invoice={...invoice,id:'in_retry'};fail=true;await service.handle({...event,data:{object:{id:'in_retry'}}},'campaign');assert.equal(sends,1);await db.query("UPDATE membership_payment_alerts SET retry_at=NOW() WHERE invoice_id='in_retry'");fail=false;await service.retry();assert.equal(sends,2);});
 await t.test('late failure after payment sends nothing and resolves pending notice',async()=>{invoice={...invoice,id:'in_paid'};fail=true;await service.handle({...event,data:{object:{id:'in_paid'}}},'campaign');invoice.status='paid';invoice.amount_remaining=0;fail=false;await service.handle({...event,type:'invoice.paid',data:{object:{id:'in_paid'}}},'campaign');await db.query("UPDATE membership_payment_alerts SET retry_at=NOW() WHERE invoice_id='in_paid'");await service.retry();assert.equal(sends,2);assert.ok((await db.query("SELECT resolved_at FROM membership_payment_alerts WHERE invoice_id='in_paid'")).rows[0].resolved_at);});
 }finally{campaign.retrieveInvoice=old.retrieve;normal.retrieveInvoice=old.normal;mail.sendEmail=old.send;await db.query('DELETE FROM users WHERE id=$1',[user.id]);}
});
