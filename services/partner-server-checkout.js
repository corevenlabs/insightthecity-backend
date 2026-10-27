const crypto = require('node:crypto');
const L = require('./partner-payment-link.service');
const fail = message => { throw Object.assign(new Error(message), {status:409}); };
function expected(row) {
  if (row.offer==='founding' && row.amount_cents===30000) return {subtotal:120000,percent:75};
  if (row.offer==='strategic' && row.amount_cents===0) return {subtotal:180000,percent:100};
  fail('La oferta no coincide con el acuerdo. Contacta a tu ejecutivo de ITC Club.');
}
function validateOpen(session,row) {
  const spec=expected(row), d=session.total_details;
  return L.isServerSession(session,row.offer) && session.status==='open' && session.payment_status==='unpaid' && session.mode==='payment' &&
    session.livemode===!L.testMode() && session.currency==='usd' && session.client_reference_id===L.reference(row) &&
    session.metadata.partner_id===row.id && session.amount_subtotal===spec.subtotal &&
    d && d.amount_discount===spec.subtotal-row.amount_cents && d.amount_shipping===0 &&
    Number.isSafeInteger(d.amount_tax) && d.amount_tax>=0 && session.amount_total===row.amount_cents+d.amount_tax &&
    (row.offer!=='strategic' || session.amount_total===0) && session.allow_promotion_codes!==true &&
    (L.testMode() || session.automatic_tax?.enabled===true) &&
    typeof session.url==='string' && new URL(session.url).origin==='https://checkout.stripe.com';
}
async function configuration(stripe,row) {
  const spec=expected(row), link=await stripe.paymentLinks.retrieve(L.linkId(row.offer));
  const items=await stripe.paymentLinks.listLineItems(link.id,{limit:100});
  const item=items.data[0], price=item?.price;
  if(link.livemode!==!L.testMode() || items.has_more || items.data.length!==1 || item.quantity!==1 ||
    item.adjustable_quantity?.enabled || price?.unit_amount!==spec.subtotal || price.currency!=='usd' || price.recurring ||
    (!L.testMode() && (!link.automatic_tax?.enabled || price.tax_behavior!=='exclusive')) || link.shipping_options?.length || link.optional_items?.length)
    fail('No pudimos verificar el precio de tu oferta. Inténtalo nuevamente o contacta a tu ejecutivo.');
  const url=new URL((L.testMode()?L.TEST_URLS:L.LIVE_URLS)[row.offer]);
  if(link.url!==url.origin+url.pathname)fail('El producto de pago no corresponde a la invitación.');
  const promos=await stripe.promotionCodes.list({code:url.searchParams.get('prefilled_promo_code'),active:true,limit:100});
  if(promos.data.length!==1)fail('No pudimos verificar el descuento de tu invitación. Inténtalo nuevamente.');
  const promo=promos.data[0], ref=promo.coupon||promo.promotion?.coupon;
  const coupon=typeof ref==='string'?await stripe.coupons.retrieve(ref):ref;
  const now=Date.now()/1000, product=typeof price.product==='string'?price.product:price.product?.id;
  if(!coupon?.valid || coupon.percent_off!==spec.percent || coupon.amount_off || promo.customer || promo.customer_account ||
    promo.restrictions?.first_time_transaction || promo.restrictions?.minimum_amount ||
    (promo.expires_at && promo.expires_at<=now) || (coupon.redeem_by && coupon.redeem_by<=now) ||
    (promo.max_redemptions && promo.times_redeemed>=promo.max_redemptions) ||
    (coupon.max_redemptions && coupon.times_redeemed>=coupon.max_redemptions) ||
    (coupon.applies_to?.products && !coupon.applies_to.products.includes(product)))
    fail('El descuento no está disponible. Contacta a tu ejecutivo antes de continuar.');
  return {link,price,coupon};
}
async function create(stripe,row,invitationUrl) {
  const {link,price,coupon}=await configuration(stripe,row);
  let customer=row.stripe_partner_customer_id?await stripe.customers.retrieve(row.stripe_partner_customer_id):null;
  if(!customer || customer.deleted || customer.email?.toLowerCase()!==row.email.toLowerCase()) {
    customer=await stripe.customers.create({email:row.email,name:row.business_name,metadata:{partner_id:row.id}},
      {idempotencyKey:`itc-partner-customer:${row.id}:${crypto.createHash('sha256').update(row.email).digest('hex').slice(0,20)}`});
  }
  const base=(process.env.PUBLIC_BASE_URL||'https://itc-backend-1031252664334.us-east1.run.app').replace(/\/$/,'');
  const cancel=new URL(invitationUrl);cancel.searchParams.set('checkout','retry');
  const attempt=Number(row.checkout_attempt||0)+1;
  const session=await stripe.checkout.sessions.create({
    mode:'payment',customer:customer.id,client_reference_id:L.reference(row),
    line_items:[{price:price.id,quantity:1}],discounts:[{coupon:coupon.id}],
    automatic_tax:{enabled:!L.testMode()},billing_address_collection:'required',
    customer_update:{address:'auto',name:'auto'},adaptive_pricing:{enabled:false},
    ...(link.name_collection?{name_collection:link.name_collection}:{}),
    ...(link.tax_id_collection?.enabled?{tax_id_collection:{enabled:true}}:{}),
    metadata:{itc_partner_checkout:'fixed-discount-v1',partner_id:row.id,offer:row.offer},
    success_url:`${base}/api/partners/payment/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:cancel.toString(),
  },{idempotencyKey:`itc-partner-checkout:${row.id}:${row.link_version}:${attempt}`});
  if(!validateOpen(session,row) || (typeof session.customer==='string'?session.customer:session.customer?.id)!==customer.id) {
    if(session.status==='open')await stripe.checkout.sessions.expire(session.id);
    throw Object.assign(new Error('No pudimos confirmar el importe de tu oferta. No se ha realizado ningún cobro. Inténtalo nuevamente o contacta a tu ejecutivo.'),
      {status:409,failedCheckout:{sessionId:session.id,customerId:customer.id,attempt}});
  }
  return {session,customerId:customer.id,attempt};
}
module.exports={create,configuration,validateOpen,expected};
