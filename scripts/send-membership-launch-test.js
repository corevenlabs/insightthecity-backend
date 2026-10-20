require('dotenv').config({quiet:true});
const db=require('../config/db'),launch=require('../services/membership-launch.service'),mailer=require('../services/password-reset-mail.service');
(async()=>{
 if(require('../services/membership-mode.service').live()||!launch.enabled())throw Error('Launch sandbox disabled');
 const email=String(process.env.MEMBERSHIP_TEST_EMAIL||'').trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('A valid explicitly selected test recipient is required');
 if(!mailer.isConfigured())throw Error('Email transport not configured');
 const existing=(await db.query('SELECT stripe_subscription_id,is_premium FROM users WHERE LOWER(email)=$1',[email])).rows[0];
 if(existing)throw Error('This invitation is exclusively for new users. The selected email already has an account.');
 const invite=await launch.issue(email),base='https://itc-backend-1031252664334.us-east1.run.app';
 const url=base+'/membership-invitation#'+invite.token;
 const message=require('../services/membership-invitation-email.service').render({base,url,sandbox:true});
 await mailer.send({to:email,...message});
 console.log('Individual test invitation delivered; private URL omitted.');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());
