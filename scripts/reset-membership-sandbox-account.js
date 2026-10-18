// Maintenance only: inspect one explicitly authorized test account. Never deploy.
const db=require('../config/db'),Stripe=require('stripe'),launch=require('../services/membership-launch.service');
const TARGET='info@insightthecity.com',ACCOUNT='acct_1U5uGXEbsP0HgIuf';
const ident=s=>{if(!/^[a-z][a-z0-9_]*$/.test(s))throw Error('Invalid schema identifier');return '"'+s+'"';};
(async()=>{
 if(process.env.MEMBERSHIP_TEST_EMAIL!==TARGET||!/^sk_test_/.test(process.env.STRIPE_SECRET_KEY||''))throw Error('Only the authorized Sandbox recipient is allowed');
 if(!['audit','reset'].includes(process.env.MEMBERSHIP_RESET_MODE))throw Error('Explicit audit/reset mode required');
 const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);if((await stripe.accounts.retrieve()).id!==ACCOUNT)throw Error('Sandbox account mismatch');
 const users=(await db.query('SELECT id,email,stripe_customer_id,stripe_subscription_id,subscription_status,is_premium,avatar_url FROM users WHERE LOWER(email)=$1',[TARGET])).rows;
 if(users.length>1)throw Error('Unexpected duplicate accounts');
 const user=users[0],counts={};
 if(user){const tables=(await db.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='user_id' ORDER BY table_name")).rows.map(r=>r.table_name);for(const table of tables)counts[table]=(await db.query(`SELECT count(*)::int n FROM ${ident(table)} WHERE user_id=$1`,[user.id])).rows[0].n;}
 const invites=(await db.query('SELECT id,user_id,checkout_id,setup_intent_id,subscription_id,activated_at IS NOT NULL activated FROM membership_launch_invitations WHERE email_hash=$1',[launch.emailHash(TARGET)])).rows;
 const customers=[];for await(const customer of stripe.customers.list({email:TARGET,limit:100})){if(customer.email?.toLowerCase()!==TARGET)throw Error('Unexpected customer');const subscriptions=[];for await(const sub of stripe.subscriptions.list({customer:customer.id,status:'all',limit:100})){if(sub.livemode!==false)throw Error('Live subscription found');subscriptions.push({id:sub.id,status:sub.status,userId:sub.metadata?.user_id,invitationId:sub.metadata?.launch_invitation_id});}customers.push({id:customer.id,subscriptions});}
 console.log(JSON.stringify({target:TARGET,user:user?{id:user.id,customerId:user.stripe_customer_id,subscriptionId:user.stripe_subscription_id,status:user.subscription_status,premium:user.is_premium,hasAvatar:Boolean(user.avatar_url)}:null,counts,invitations:invites,customers}));
 if(process.env.MEMBERSHIP_RESET_MODE==='audit')return;
 const EXPECTED={userId:13,customerId:'cus_VSvNgZnsDoJoXg',subscriptionId:'sub_1URzWyEbsP0HgIufRO3zfO3n',invitationId:'f63ec822-f42c-4e0b-a39c-3a7d228f4ce5'};
 function validate(current,rows,owned){
  if(!current||current.id!==EXPECTED.userId||current.stripe_customer_id!==EXPECTED.customerId||current.stripe_subscription_id!==EXPECTED.subscriptionId||current.avatar_url)throw Error('Account differs from the audited test account');
  if(rows.length!==1||rows[0].id!==EXPECTED.invitationId||rows[0].user_id!==EXPECTED.userId||rows[0].subscription_id!==EXPECTED.subscriptionId)throw Error('Invitation differs from audit');
  if(owned.legal_acceptances!==3||owned.membership_launch_invitations!==1)throw Error('Owned records differ from audit');
  for(const [table,count]of Object.entries(owned))if(count&&!['legal_acceptances','membership_launch_invitations'].includes(table))throw Error('Unexpected owned data in '+table);
 }
 validate(user,invites,counts);
 if(customers.length!==1||customers[0].id!==EXPECTED.customerId||customers[0].subscriptions.length!==1)throw Error('Unexpected Sandbox billing records');
 const known=await stripe.subscriptions.retrieve(EXPECTED.subscriptionId);
 if(known.customer!==EXPECTED.customerId||known.livemode!==false||known.metadata?.user_id!=='13'||known.metadata?.launch_invitation_id!==EXPECTED.invitationId)throw Error('Subscription ownership differs from audit');
 const canceled=known.status==='canceled'?known:await stripe.subscriptions.cancel(known.id,{invoice_now:false,prorate:false});
 if(canceled.status!=='canceled'||canceled.livemode!==false)throw Error('Sandbox subscription cancellation not confirmed');
 console.log('Authorized Sandbox subscription canceled immediately; no invoice or prorated charge requested.');
 // Give the cancellation webhook time to finish before removing the test account.
 for(let n=0;n<20;n++){const row=(await db.query('SELECT subscription_status FROM users WHERE id=$1',[EXPECTED.userId])).rows[0];if(row?.subscription_status==='canceled')break;await new Promise(r=>setTimeout(r,1000));}
 for await(const sub of stripe.subscriptions.list({customer:EXPECTED.customerId,status:'all',limit:100}))if(sub.livemode!==false||!['canceled','incomplete_expired'].includes(sub.status))throw Error('A Sandbox subscription remains open');
 const c=await db.connect();let committed=false;
 try{
  await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(71300300)');
  const rows=(await c.query('SELECT * FROM membership_launch_invitations WHERE email_hash=$1 FOR UPDATE',[launch.emailHash(TARGET)])).rows;
  const current=(await c.query('SELECT * FROM users WHERE LOWER(email)=$1 FOR UPDATE',[TARGET])).rows;
  if(current.length!==1)throw Error('Expected one audited account');
  const owned={};const tables=(await c.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='user_id' ORDER BY table_name")).rows.map(r=>r.table_name);
  for(const table of tables)owned[table]=(await c.query(`SELECT count(*)::int n FROM ${ident(table)} WHERE user_id=$1`,[EXPECTED.userId])).rows[0].n;
  validate(current[0],rows,owned);
  const removed={acceptances:(await c.query('DELETE FROM legal_acceptances WHERE user_id=$1',[EXPECTED.userId])).rowCount,invitations:(await c.query('DELETE FROM membership_launch_invitations WHERE id=$1 AND user_id=$2',[EXPECTED.invitationId,EXPECTED.userId])).rowCount,users:(await c.query('DELETE FROM users WHERE id=$1 AND LOWER(email)=$2',[EXPECTED.userId,TARGET])).rowCount};
  if(removed.acceptances!==3||removed.invitations!==1||removed.users!==1)throw Error('Unexpected deletion count');
  if((await c.query('SELECT id FROM users WHERE LOWER(email)=$1',[TARGET])).rowCount||(await c.query('SELECT id FROM membership_launch_invitations WHERE email_hash=$1',[launch.emailHash(TARGET)])).rowCount)throw Error('Reset verification failed');
  await c.query('COMMIT');committed=true;
  const deleted=await stripe.customers.del(EXPECTED.customerId);if(deleted.deleted!==true)throw Error('Sandbox customer cleanup pending');
  console.log(JSON.stringify({resetComplete:true,target:TARGET,removed,sandboxSubscriptionCanceled:true,sandboxCustomerDeleted:true,oldInvitationRevoked:true,readyForNewRegistration:true,productionCodeDeployed:false}));
 }catch(e){if(!committed)await c.query('ROLLBACK');throw e;}finally{c.release();}

})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());
