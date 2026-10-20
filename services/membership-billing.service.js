// Persisted source ensures cancellation, deletion and synchronization use the original account.
const normal=require('./stripe.service'),campaign=require('./membership-campaign-stripe.service');
function forUser(user){return user?.stripe_billing_source==='campaign'?campaign:normal;}
module.exports={forUser};
