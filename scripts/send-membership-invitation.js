require('dotenv').config({quiet:true});
// No automatic bulk delivery: an explicit recipient and --send are required.
if(!process.argv.includes('--send')){console.log('No mail sent. Select MEMBERSHIP_INVITE_EMAIL and pass --send to send one invitation.');}
else{
 const db=require('../config/db');
 require('../services/membership-invitation-delivery.service').send(process.env.MEMBERSHIP_INVITE_EMAIL)
 .then(result=>console.log(result.sent?'Invitation accepted by SMTP.':'Invitation was already sent; skipped.'))
 .catch(()=>{console.error('Invitation failed. Review campaign, legal, recipient and SMTP configuration. Private values omitted.');process.exitCode=1;})
 .finally(()=>db.end());
}
