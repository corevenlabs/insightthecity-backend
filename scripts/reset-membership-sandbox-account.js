// One-off, explicitly authorized Sandbox test account only. No deployment.
const db=require('../config/db'),Stripe=require('stripe'),launch=require('../services/membership-launch.service');
const TARGET='info@insightthecity.com',ACCOUNT='acct_1U5uGXEbsP0HgIuf',SUB='sub_1URxH7EbsP0HgIufvXljNRYo';
const ident=s=>{if(!/^[a-z][a-z0-9_]*$/.test(s))throw Error('Invalid schema identifier');return '"'+s+'"';};
(async()=>{
 if(process.env.MEMBERSHIP_TEST_EMAIL!==TARGET||!/^sk_test_/.test(process.env.STRIPE_SECRET_KEY||''))throw Error('Only the authorized Sandbox recipient is allowed');
 if(!['audit','reset'].includes(process.env.MEMBERSHIP_RESET_MODE))throw Error('Explicit audit/reset mode required');
 const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);if((await stripe.accounts.retrieve()).id!==ACCOUNT)throw Error('Sandbox account mismatch');
 const expected=await stripe.subscriptions.retrieve(SUB);if(expected.livemode!==false||expected.status!=='canceled')throw Error('The known Sandbox subscription must already be canceled');
 const customer=await stripe.customers.retrieve(expected.customer);if(customer.deleted||customer.email?.toLowerCase()!==TARGET)throw Error('Sandbox customer mismatch');
 for await(const sub of stripe.subscriptions.list({customer:customer.id,status:'all',limit:100}))if(sub.livemode!==false||!['canceled','incomplete_expired'].includes(sub.status))throw Error('A subscription is still active; stop reset');
 const c=await db.connect();try{
 await c.query('BEGIN');
 const users=(await c.query('SELECT id,email,stripe_customer_id,stripe_subscription_id,subscription_status,is_premium,avatar_url FROM users WHERE LOWER(email)=$1 FOR UPDATE',[TARGET])).rows;
 if(users.length!==1)throw Error('Expected exactly one app account');const user=users[0];
 if(user.stripe_customer_id!==customer.id||user.stripe_subscription_id!==SUB)throw Error('App account billing references do not match the canceled Sandbox subscription');
 const counts={};const tables=(await c.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='user_id' ORDER BY table_name")).rows.map(r=>r.table_name);
 for(const table of tables)counts[table]=(await c.query(`SELECT count(*)::int n FROM ${ident(table)} WHERE user_id=$1`,[user.id])).rows[0].n;
 const refs=(await c.query("SELECT conrelid::regclass::text child,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE contype='f' AND confrelid='users'::regclass ORDER BY conrelid::regclass::text")).rows;
 const invites=(await c.query('SELECT id,user_id,activated_at IS NOT NULL activated FROM membership_launch_invitations WHERE email_hash=$1',[launch.emailHash(TARGET)])).rows;
 console.log(JSON.stringify({mode:process.env.MEMBERSHIP_RESET_MODE,target:TARGET,userId:user.id,subscriptionStatus:user.subscription_status,premium:user.is_premium,hasAvatar:Boolean(user.avatar_url),counts,foreignKeys:refs,invitations:invites.length,invitationActivated:invites.some(i=>i.activated),sandboxCanceled:true}));
 if(process.env.MEMBERSHIP_RESET_MODE==='audit'){await c.query('ROLLBACK');return;}
 throw Error('Reset is intentionally disabled until the audit is reviewed');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());
