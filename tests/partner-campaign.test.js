const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../services/partner-campaign-rules');
const {validCheckout,validInvoice}=require('../services/partner-campaign-billing');
const fixture=()=>({name:'Community Partners',mode:'installments',currency:'usd',normalPriceCents:20000,priceCents:14000,installments:4,publicationMonths:4,publicationStart:'publication',renewal:true,renewalPriceCents:20000,termsTitle:'Participation agreement',termsContent:'Four monthly payments. Publication begins after approval.',termsApproved:true});
test('campaign rules: complete validated defaults, finite commitment and month-end dates',()=>{
 const c=R.config(fixture());assert.equal(c.emails.payment.subject,R.EMAILS.payment.subject);R.publishable(c);
 assert.equal(c.priceCents*c.installments,56000);
 assert.equal(R.addMonths('2027-01-31T12:00:00Z',1).toISOString(),'2027-02-28T12:00:00.000Z');
 for(const patch of [{priceCents:20001},{installments:0},{publicationMonths:3},{currency:'jpy'},{startsAt:'tomorrow'},{endsAt:'2020-01-01',startsAt:'2021-01-01'}])assert.throws(()=>R.config({...fixture(),...patch}));
 assert.throws(()=>R.publishable(R.config({...fixture(),termsApproved:false})),/términos/);
 assert.throws(()=>R.config({...fixture(),emails:{payment:{subject:'Hello {unknown}',title:'Title',body:'Body'}}}),/Variable/);
 assert.throws(()=>R.config({...fixture(),emails:{payment:{subject:'Hello\nBcc: bad',title:'Title',body:'Body'}}}),/correos/);
 assert.equal(R.available({startsAt:'2027-01-01'},new Date('2026-12-01')),false);
});
test('checkout refuses wrong discount, extra codes, shipping or amount before showing payment',()=>{
 const p={id:'p',campaign_snapshot:{id:'r',livemode:false,config:R.config(fixture())}};
 const s={mode:'subscription',status:'open',payment_status:'unpaid',metadata:{partner_id:'p',revision_id:'r'},amount_subtotal:20000,currency:'usd',livemode:false,total_details:{amount_discount:6000,amount_shipping:0,amount_tax:0},amount_total:14000,automatic_tax:{enabled:true},url:'https://checkout.stripe.com/test'};
 assert.equal(validCheckout(s,p),true);
 for(const patch of [{amount_total:20000},{allow_promotion_codes:true},{currency:'eur'},{total_details:{amount_discount:0,amount_shipping:0,amount_tax:0}},{metadata:{partner_id:'other',revision_id:'r'}}])assert.equal(validCheckout({...s,...patch},p),false);
});
test('invoice validation rejects excess installments amounts, credits and proration',()=>{
 const p={campaign_snapshot:{price_id:'price_initial',renewal_price_id:'price_renewal',config:R.config(fixture())}};
 const i={currency:'usd',subtotal:20000,total_discount_amounts:[{amount:6000}],starting_balance:0,lines:{data:[{quantity:1,price:'price_initial'}],has_more:false},total:14000,amount_due:14000,amount_paid:14000,amount_remaining:0,status:'paid',paid:true};
 assert.equal(validInvoice(i,p,'initial'),true);
 for(const patch of [{subtotal:14000},{amount_paid:20000},{starting_balance:-100},{paid_out_of_band:true},{total_discount_amounts:[]},{lines:{data:[{quantity:1,proration:true}]}}])assert.equal(validInvoice({...i,...patch},p,'initial'),false);
 assert.equal(validInvoice({...i,subtotal:20000,total_discount_amounts:[],total:20000,amount_due:20000,amount_paid:20000,lines:{data:[{quantity:1,price:'price_renewal'}]}},p,'renewal'),true);
});
test('campaign email keeps branded layout, escaped copy, invoice and billing disclosure',async()=>{
 const E=require('../services/partner-campaign-email');const c=R.config(fixture());
 const client={business_name:'A <script> shop',contact_name:'Alex',campaign_snapshot:{config:c}};
 const m=E.render('payment',{client,url:'javascript:alert(1)'});
 assert.match(m.subject,/Community Partners/);assert.match(m.html,/A &lt;script&gt; shop/);assert.doesNotMatch(m.html,/href="javascript:/);assert.match(m.text,/4 monthly installments/);assert.match(m.text,/\$560.00/);
 const pdf=await E.receipt({id:'in_test',amount_paid:14000,currency:'usd',created:1800000000,livemode:false},client);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
});
module.exports={fixture};
