// Maintenance only: inspect one explicitly authorized test account. Never deploy.
const db=require('../config/db'),Stripe=require('stripe'),launch=require('../services/membership-launch.service');
const TARGET='info@insightthecity.com',ACCOUNT='acct_1U5uGXEbsP0HgIuf';
const ident=s=>{if(!/^[a-z][a-z0-9_]*$/.test(s))throw Error('Invalid schema identifier');return '"'+s+'"';};
(async()=>{
 if(process.env.MEMBERSHIP_TEST_EMAIL!==TARGET||!/^sk_test_/.test(process.env.STRIPE_SECRET_KEY||''))throw Error('Only the authorized Sandbox recipient is allowed');
 if(process.env.MEMBERSHIP_RESET_MODE!=='audit')throw Error('Audit required before another reset');
 const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);if((await stripe.accounts.retrieve()).id!==ACCOUNT)throw Error('Sandbox account mismatch');
 const users=(await db.query('SELECT id,email,stripe_customer_id,stripe_subscription_id,subscription_status,is_premium,avatar_url FROM users WHERE LOWER(email)=$1',[TARGET])).rows;
 if(users.length>1)throw Error('Unexpected duplicate accounts');
 const user=users[0],counts={};
 if(user){const tables=(await db.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='user_id' ORDER BY table_name")).rows.map(r=>r.table_name);for(const table of tables)counts[table]=(await db.query(`SELECT count(*)::int n FROM ${ident(table)} WHERE user_id=$1`,[user.id])).rows[0].n;}
 const invites=(await db.query('SELECT id,user_id,checkout_id,setup_intent_id,subscription_id,activated_at IS NOT NULL activated FROM membership_launch_invitations WHERE email_hash=$1',[launch.emailHash(TARGET)])).rows;
 const customers=[];for await(const customer of stripe.customers.list({email:TARGET,limit:100})){if(customer.email?.toLowerCase()!==TARGET)throw Error('Unexpected customer');const subscriptions=[];for await(const sub of stripe.subscriptions.list({customer:customer.id,status:'all',limit:100})){if(sub.livemode!==false)throw Error('Live subscription found');subscriptions.push({id:sub.id,status:sub.status,userId:sub.metadata?.user_id,invitationId:sub.metadata?.launch_invitation_id});}customers.push({id:customer.id,subscriptions});}
 console.log(JSON.stringify({target:TARGET,user:user?{id:user.id,customerId:user.stripe_customer_id,subscriptionId:user.stripe_subscription_id,status:user.subscription_status,premium:user.is_premium,hasAvatar:Boolean(user.avatar_url)}:null,counts,invitations:invites,customers}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());
