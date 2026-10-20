const {test}=require('node:test'),assert=require('node:assert/strict');
const {render}=require('../services/membership-payment-failed-email.service'),{paymentUrl,subscriptionId}=require('../services/membership-payment-alert.service');
test('payment notices use branded banners, escaped data, exact amount and localized action',()=>{
 for(const language of ['es','en','pt']){
 const message=render({user:{name:'<Rafa>',language},invoice:{amount_remaining:499,currency:'usd'},url:'https://invoice.stripe.com/i/secure'});
 assert.match(message.html,new RegExp(`membership-payment-failed-${language}-v1.png`));assert.match(message.html,/Arial,Helvetica,sans-serif/);assert.match(message.html,/&lt;Rafa&gt;/);assert.doesNotMatch(message.html,/<Rafa>|undefined|Invalid Date/);assert.match(message.html,/4[.,]99/);
 }
});
test('only HTTPS Stripe invoice pages are used; current and legacy invoice subscription IDs supported',()=>{
 assert.equal(paymentUrl('https://invoice.stripe.com/i/secure'),'https://invoice.stripe.com/i/secure');
 for(const url of ['https://evil.test','http://invoice.stripe.com','https://invoice.stripe.com.evil.test','javascript:alert(1)'])assert.equal(paymentUrl(url),null);
 assert.equal(subscriptionId({parent:{subscription_details:{subscription:'sub_new'}}}),'sub_new');assert.equal(subscriptionId({subscription:{id:'sub_old'}}),'sub_old');
});
