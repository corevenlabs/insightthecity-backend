const R=require('./partner-campaign-rules');
const {fail}=require('./partner-rules');
const sec=v=>Math.floor(new Date(v).getTime()/1000),date=n=>new Date(n*1000);
const automaticTax=()=>process.env.PARTNER_CAMPAIGNS_SANDBOX==='true'?process.env.CAMPAIGN_SANDBOX_TAX_ENABLED==='true':true;
const subId=i=>R.idOf(i.parent?.subscription_details?.subscription||i.subscription);
function validCheckout(s,p){const r=p.campaign_snapshot,c=r.config,d=s.total_details;return s.mode===(c.mode==='installments'?'subscription':'payment')&&s.status==='open'&&s.payment_status==='unpaid'&&s.metadata?.revision_id===r.id&&s.metadata?.partner_id===p.id&&s.amount_subtotal===c.normalPriceCents&&s.currency===c.currency&&s.livemode===r.livemode&&d?.amount_discount===c.normalPriceCents-c.priceCents&&d.amount_shipping===0&&Number.isSafeInteger(d.amount_tax)&&d.amount_tax>=0&&s.amount_total===c.priceCents+d.amount_tax&&s.allow_promotion_codes!==true&&s.automatic_tax?.enabled===automaticTax()&&s.url?.startsWith('https://checkout.stripe.com/');}
function validInvoice(i,row,phase){
 const c=row.campaign_snapshot.config,normal=phase==='renewal'?c.renewalPriceCents:c.normalPriceCents,expected=phase==='renewal'?c.renewalPriceCents:c.priceCents;
 const discount=(i.total_discount_amounts||[]).reduce((sum,d)=>sum+d.amount,0),line=i.lines?.data?.[0];
 const price=R.idOf(line?.pricing?.price_details?.price||line?.price),tax=(i.total_taxes||i.total_tax_amounts||[]).reduce((sum,t)=>sum+t.amount,0);
 return i.currency===c.currency&&(i.subtotal_excluding_tax??i.subtotal)===normal&&discount===normal-expected&&!i.starting_balance&&!i.paid_out_of_band&&
  i.lines?.data?.length===1&&!i.lines.has_more&&line.quantity===1&&!line.proration&&!line.parent?.subscription_item_details?.proration&&
  price===(phase==='renewal'?row.campaign_snapshot.renewal_price_id:row.campaign_snapshot.price_id)&&Number.isSafeInteger(tax)&&tax>=0&&
  i.total===expected+tax&&i.amount_due===i.total&&(i.total_excluding_tax==null||i.total_excluding_tax===expected)&&
  (i.status!=='paid'||(i.paid&&i.amount_paid===i.amount_due&&i.amount_remaining===0));
}
function createService({db,transaction,stripe,campaigns,mail,link,now=()=>new Date()}){
 const row=async(c,id)=>(await c.query('SELECT * FROM partner_clients WHERE id=$1 FOR UPDATE',[id])).rows[0];
 const billing=async(c,id)=>(await c.query('SELECT *,restore_version::text AS restore_version FROM partner_campaign_billing WHERE client_id=$1 FOR UPDATE',[id])).rows[0];
 async function notify(c,p,kind,key,extra={}){const owner=(await c.query('SELECT name,email,phone FROM admins WHERE id=$1',[p.owner_id])).rows[0]||{};await mail.queue(c,{clientId:p.id,key:`campaign:${p.id}:${key}`,to:p.email,kind,data:{client:p,owner,url:link(p),billing:await billing(c,p.id),...extra}});}
 async function checkout(c,p){
  const r=p.campaign_snapshot,cfg=r.config;await campaigns.verify(r);
  let b=await billing(c,p.id);if(b?.first_paid_at)fail('El primer pago ya está confirmado',409);
  if(p.stripe_session_id){const old=await stripe.checkout.sessions.retrieve(p.stripe_session_id);if(old.status==='complete')fail('El pago está en verificación. Actualiza el estado.',409);if(old.status==='open'&&validCheckout(old,p)&&R.idOf(old.customer)===b?.customer_id)return {url:old.url};if(old.status==='open')await stripe.checkout.sessions.expire(old.id);}
  const attempt=Number(p.checkout_attempt||0)+1;
  const customer=await stripe.customers.create({email:p.email,name:p.business_name,metadata:{partner_id:p.id,itc_partner_campaign:'v1'}},{idempotencyKey:`campaign-customer:${p.id}:${require('crypto').createHash('sha256').update(p.email).digest('hex').slice(0,16)}`});
  const meta={itc_partner_campaign:'v1',partner_id:p.id,revision_id:p.campaign_revision_id,invitation_version:p.link_version,phase:'initial'};
  const base=(process.env.PUBLIC_BASE_URL||'https://itc-backend-1031252664334.us-east1.run.app').replace(/\/$/,'');
  const s=await stripe.checkout.sessions.create({mode:cfg.mode==='installments'?'subscription':'payment',customer:customer.id,client_reference_id:p.id,
   metadata:meta,line_items:[{price:r.price_id,quantity:1}],...(r.coupon_id?{discounts:[{coupon:r.coupon_id}]}:{}),
   ...(cfg.mode==='installments'?{subscription_data:{metadata:meta}}:{invoice_creation:{enabled:true,invoice_data:{metadata:meta}},...(cfg.renewal?{payment_intent_data:{setup_future_usage:'off_session',metadata:meta}}:{})}),
   automatic_tax:{enabled:automaticTax()},billing_address_collection:'required',customer_update:{address:'auto',name:'auto'},payment_method_types:['card'],
   success_url:`${base}/api/partners/payment/return?session_id={CHECKOUT_SESSION_ID}`,cancel_url:link(p),
  },{idempotencyKey:`campaign-checkout:${p.id}:${p.link_version}:${attempt}`});
  const valid=validCheckout(s,p)&&R.idOf(s.customer)===customer.id;
  if(!valid&&s.status==='open')await stripe.checkout.sessions.expire(s.id);
  await c.query('UPDATE partner_clients SET stripe_session_id=$2,stripe_partner_customer_id=$3,checkout_attempt=$4 WHERE id=$1',[p.id,s.id,customer.id,attempt]);
  await c.query('INSERT INTO partner_campaign_billing(client_id,customer_id,checkout_session_id) VALUES($1,$2,$3) ON CONFLICT(client_id) DO UPDATE SET customer_id=$2,checkout_session_id=$3',[p.id,customer.id,s.id]);
  // Commit the expired attempt before reporting the error, so a corrected retry
  // receives a fresh Stripe idempotency key rather than the same expired session.
  return valid?{url:s.url}:{checkoutError:'Stripe no confirmó el precio y el descuento. No se ha habilitado el pago.'};
 }
 async function record(c,p,i,phase){const period=i.lines?.data?.[0]?.period;await c.query(`INSERT INTO partner_campaign_invoices(invoice_id,client_id,phase,status,amount_due,amount_paid,currency,period_start,period_end,hosted_url,pdf_url,paid_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(invoice_id) DO UPDATE SET status=EXCLUDED.status,amount_paid=EXCLUDED.amount_paid,paid_at=EXCLUDED.paid_at,hosted_url=EXCLUDED.hosted_url,pdf_url=EXCLUDED.pdf_url,updated_at=NOW()`,[i.id,p.id,phase,i.status,i.amount_due,i.amount_paid,i.currency,period?.start?date(period.start):null,period?.end?date(period.end):null,i.hosted_invoice_url||null,i.invoice_pdf||null,i.status_transitions?.paid_at?date(i.status_transitions.paid_at):null]);}
 async function confirm(sessionId){
  const s=await stripe.checkout.sessions.retrieve(sessionId,{expand:['subscription.latest_invoice','subscription.default_payment_method','invoice','payment_intent']});
  if(s.metadata?.itc_partner_campaign!=='v1')return false;
  await transaction(async c=>{
   const p=await row(c,s.metadata.partner_id);if(!R.isCampaign(p)||p.deleted_at||p.blocked_at||p.stripe_session_id!==s.id||p.campaign_revision_id!==s.metadata.revision_id)fail('Checkout no vinculado a esta invitación',409);
   const r=p.campaign_snapshot,cfg=r.config,b=await billing(c,p.id);
   if(s.status!=='complete'||s.payment_status!=='paid'||s.livemode!==r.livemode||R.idOf(s.customer)!==b?.customer_id)fail('Pago de campaña aún no confirmado',409);
   if(b.first_paid_at)return;
   if(!(await c.query("SELECT 1 FROM partner_acceptances WHERE client_id=$1 AND stage='commercial' AND document->>'invitationVersion'=$2 LIMIT 1",[p.id,String(p.link_version)])).rowCount)fail('Falta aceptar las condiciones de esta invitación',409);
   const subscription=cfg.mode==='installments'?s.subscription:null;
   const value=subscription?subscription.latest_invoice:s.invoice;
   const i=typeof value==='string'?await stripe.invoices.retrieve(value):value;
   if(!i||i.status!=='paid'||R.idOf(i.customer)!==b.customer_id||!validInvoice(i,p,'initial'))fail('Factura inicial no confirmada por el importe esperado',409);
   if(subscription&&(R.idOf(subscription.customer)!==b.customer_id||subscription.metadata?.revision_id!==r.id||subId(i)!==subscription.id))fail('Suscripción ajena a esta campaña',409);
   let schedule=null;
   if(subscription){
    schedule=subscription.schedule?await stripe.subscriptionSchedules.retrieve(R.idOf(subscription.schedule)):await stripe.subscriptionSchedules.create({from_subscription:subscription.id},{idempotencyKey:`campaign-fixed:${p.id}:${subscription.id}`});
    schedule=await stripe.subscriptionSchedules.update(schedule.id,{end_behavior:'cancel',proration_behavior:'none',phases:[{start_date:schedule.phases[0].start_date,duration:{interval:'month',interval_count:cfg.installments},items:[{price:r.price_id,quantity:1}],...(r.coupon_id?{discounts:[{coupon:r.coupon_id}]}:{}),metadata:{itc_partner_campaign:'v1',partner_id:p.id,revision_id:r.id,phase:'initial'},proration_behavior:'none'}]},{idempotencyKey:`campaign-fixed-config:${p.id}:${subscription.id}`});
   }
   const paidAt=date(i.status_transitions.paid_at),pm=R.idOf(subscription?.default_payment_method)||R.idOf(s.payment_intent?.payment_method);
   if(cfg.renewal&&!pm)fail('Esperando confirmación del medio de pago para la renovación',409);
   const start=cfg.publicationStart==='payment'?paidAt:null,end=start?R.addMonths(start,cfg.publicationMonths):null;
   await c.query("UPDATE partner_campaign_billing SET initial_subscription_id=$2,initial_schedule_id=$3,initial_invoice_id=$4,first_paid_at=$5,billing_end=$6,payment_method_id=$7,publication_start=$8,publication_end=$9,status='active' WHERE client_id=$1",[p.id,subscription?.id||null,schedule?.id||null,i.id,paidAt,schedule?date(schedule.phases[0].end_date):paidAt,pm||null,start,end]);
   await c.query("UPDATE partner_clients SET payment_status='paid',payment_verified_at=$2,form_status='invited' WHERE id=$1",[p.id,paidAt]);
   await record(c,p,i,'initial');await notify(c,p,'invite','welcome',{invoice:i});
   await c.query("INSERT INTO partner_activity(client_id,kind,note) VALUES($1,'campaign-payment','Primer pago confirmado por Stripe; formulario habilitado')",[p.id]);
  });return true;
 }
 async function activate(c,p,experienceId,actor){
  if(!R.isCampaign(p))return;
  const b=await billing(c,p.id),cfg=p.campaign_snapshot.config;
  if(!b?.first_paid_at||b.suspended_at||b.status!=='active'||p.blocked_at)fail('Revisa los pagos pendientes antes de publicar',409);
  if(p.activated_at)return;
  const start=b.publication_start||now(),end=b.publication_end||R.addMonths(start,cfg.publicationMonths);
  if(new Date(end)<=now())fail('La vigencia de esta campaña ya terminó. Revisa la ficha antes de publicar.',409);
  await c.query('UPDATE partner_campaign_billing SET publication_start=$2,publication_end=$3 WHERE client_id=$1',[p.id,start,end]);
  await c.query('UPDATE partner_clients SET experience_id=$2,activated_at=$3,expires_at=$4 WHERE id=$1',[p.id,experienceId,now(),end]);
  await c.query('INSERT INTO partner_periods(client_id,starts_at,ends_at,amount_cents,reference,actor_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[p.id,start,end,cfg.priceCents*cfg.installments,`campaign:${p.id}:initial`,actor.id]);
  await notify(c,p,'published','published',{url:`${mail.BASE()}/business/${encodeURIComponent(experienceId)}`});
 }
 async function suspend(c,p,b){if(b.suspended_at)return;const e=p.experience_id?(await c.query('UPDATE experiences SET is_published=FALSE WHERE id=$1 AND is_published RETURNING id,updated_at::text AS version',[p.experience_id])).rows[0]:null;await c.query("UPDATE partner_campaign_billing SET status='past_due',suspended_at=NOW(),restore_id=$2,restore_version=$3 WHERE client_id=$1",[p.id,e?.id||null,e?.version||null]);}
 async function restore(c,p,b){await c.query("UPDATE partner_campaign_billing SET status='active',suspended_at=NULL,restore_id=NULL,restore_version=NULL WHERE client_id=$1",[p.id]);if(b.restore_id===p.experience_id&&p.activated_at&&!p.blocked_at&&!p.deleted_at&&new Date(p.expires_at)>now())await c.query('UPDATE experiences SET is_published=TRUE WHERE id=$1 AND NOT is_published AND updated_at=$2',[b.restore_id,b.restore_version]);}
 async function ensureRenewal(c,p,b){
  const r=p.campaign_snapshot,cfg=r.config;if(!cfg.renewal||!b.publication_end||b.cancel_requested_at||b.renewal_schedule_id)return;
  if(new Date(b.publication_end)<=now())return;
  const customer=await stripe.customers.retrieve(b.customer_id),pm=R.idOf(customer.invoice_settings?.default_payment_method)||b.payment_method_id;
  const schedule=await stripe.subscriptionSchedules.create({customer:b.customer_id,start_date:sec(b.publication_end),end_behavior:'release',metadata:{itc_partner_campaign:'v1',partner_id:p.id,revision_id:r.id,phase:'renewal'},default_settings:{default_payment_method:pm,collection_method:'charge_automatically',automatic_tax:{enabled:automaticTax()}},phases:[{items:[{price:r.renewal_price_id,quantity:1}],duration:{interval:'month',interval_count:1},metadata:{itc_partner_campaign:'v1',partner_id:p.id,revision_id:r.id,phase:'renewal'},proration_behavior:'none'}]},{idempotencyKey:`campaign-renewal:${p.id}:${sec(b.publication_end)}`});
  await c.query('UPDATE partner_campaign_billing SET renewal_schedule_id=$2 WHERE client_id=$1',[p.id,schedule.id]);
 }
 async function invoiceEvent(event){
  const snapshot=event.data.object,customer=R.idOf(snapshot.customer);
  // Membership customers are never queried with the partner account key.
  const known=(await db.query('SELECT p.* FROM partner_clients p JOIN partner_campaign_billing b ON b.client_id=p.id WHERE b.customer_id=$1 AND p.deleted_at IS NULL',[customer])).rows;
  if(!known.length)return false;
  let i=await stripe.invoices.retrieve(snapshot.id);const subscription=subId(i);
  let p=known.find(p=>p.id===(i.metadata?.partner_id||i.parent?.subscription_details?.metadata?.partner_id));
  let sub=null;
  if(subscription){sub=await stripe.subscriptions.retrieve(subscription);if(sub.metadata?.itc_partner_campaign!=='v1')return false;p=known.find(p=>p.id===sub.metadata.partner_id);}
  if(!p)return false;
  let b=(await db.query('SELECT * FROM partner_campaign_billing WHERE client_id=$1',[p.id])).rows[0];
  if(!b.first_paid_at&&i.status!=='paid'){
   if(!['invoice.payment_failed','invoice.payment_action_required','invoice.marked_uncollectible'].includes(event.type))return true;
   await transaction(async c=>{
    p=await row(c,p.id);b=await billing(c,p.id);if(b.first_paid_at)return;
    if((await c.query('SELECT 1 FROM partner_campaign_events WHERE event_id=$1',[event.id])).rowCount)return;
    i=await stripe.invoices.retrieve(snapshot.id);const s=await stripe.checkout.sessions.retrieve(b.checkout_session_id);
    if(i.status==='paid')return;
    if(!['open','uncollectible'].includes(i.status)||i.livemode!==p.campaign_snapshot.livemode||!validInvoice(i,p,'initial')||R.idOf(i.customer)!==b.customer_id||s.metadata?.partner_id!==p.id||s.metadata?.revision_id!==p.campaign_revision_id||(subscription?R.idOf(s.subscription)!==subscription:R.idOf(s.invoice)!==i.id))fail('Factura pendiente no vinculada a la invitación',409);
    await record(c,p,i,'initial');await notify(c,p,'payment_failed',`failed:${i.id}`,{invoice:i,url:i.hosted_invoice_url});
    await c.query('INSERT INTO partner_campaign_events(event_id) VALUES($1) ON CONFLICT DO NOTHING',[event.id]);
   });return true;
  }
  if(!b.first_paid_at){await confirm(b.checkout_session_id);}
  await transaction(async c=>{
   p=await row(c,p.id);b=await billing(c,p.id);
   if((await c.query('SELECT 1 FROM partner_campaign_events WHERE event_id=$1',[event.id])).rowCount)return;
   i=await stripe.invoices.retrieve(snapshot.id);
   const phase=sub?.metadata.phase||'initial',r=p.campaign_snapshot;
   if(phase==='renewal'&&!b.renewal_subscription_id&&b.renewal_schedule_id){const schedule=await stripe.subscriptionSchedules.retrieve(b.renewal_schedule_id);if(R.idOf(schedule.subscription||schedule.released_subscription)!==subscription)fail('Renovación no vinculada a esta campaña',409);await c.query('UPDATE partner_campaign_billing SET renewal_subscription_id=$2 WHERE client_id=$1',[p.id,subscription]);b.renewal_subscription_id=subscription;}
   if(!['initial','renewal'].includes(phase)||i.livemode!==r.livemode||!validInvoice(i,p,phase)||R.idOf(i.customer)!==b.customer_id||(subscription?subscription!==(phase==='initial'?b.initial_subscription_id:b.renewal_subscription_id):i.id!==b.initial_invoice_id))fail('La factura no corresponde al precio y acuerdo del cliente',409);
   const period=i.lines?.data?.[0]?.period;
   if(subscription&&phase==='initial'&&(!period?.start||period.start>=sec(b.billing_end)))fail('La factura excede las cuotas acordadas',409);
   await record(c,p,i,phase);
   if(i.status==='paid'){
    if(phase==='renewal'){
     if(!period?.end||period.start<sec(b.publication_end))fail('La renovación no coincide con la vigencia',409);
     await c.query('UPDATE partner_clients SET expires_at=GREATEST(expires_at,$2) WHERE id=$1',[p.id,date(period.end)]);p.expires_at=date(Math.max(sec(p.expires_at),period.end));
    }
    let open=false;
    for await(const pending of stripe.invoices.list({customer:b.customer_id,status:'open',limit:100}))if(pending.amount_remaining>0&&(R.idOf(pending.metadata?.partner_id)===p.id||[b.initial_subscription_id,b.renewal_subscription_id].filter(Boolean).includes(subId(pending))))open=true;
    let bad=(await c.query("SELECT 1 FROM partner_campaign_invoices WHERE client_id=$1 AND status='uncollectible' LIMIT 1",[p.id])).rowCount;
    if(b.initial_subscription_id){const initial=await stripe.subscriptions.retrieve(b.initial_subscription_id);if(!['active','trialing'].includes(initial.status)){const paid=Number((await c.query("SELECT count(*) AS n FROM partner_campaign_invoices WHERE client_id=$1 AND phase='initial' AND status='paid'",[p.id])).rows[0].n);if(paid<r.config.installments)bad=1;}}
    if(!open&&!bad&&b.status!=='ended')await restore(c,p,b);
    if(i.id!==b.initial_invoice_id)await notify(c,p,b.suspended_at&&!open&&!bad?'payment_recovered':'payment_paid',`receipt:${i.id}`,{invoice:i,url:i.hosted_invoice_url});
   }else if(['invoice.payment_failed','invoice.payment_action_required','invoice.marked_uncollectible'].includes(event.type)&&['open','uncollectible'].includes(i.status)){
    await suspend(c,p,b);await notify(c,p,'payment_failed',`failed:${i.id}`,{invoice:i,url:i.hosted_invoice_url});
   }
   await c.query('INSERT INTO partner_campaign_events(event_id) VALUES($1) ON CONFLICT DO NOTHING',[event.id]);
   await c.query('INSERT INTO partner_activity(client_id,kind,note) VALUES($1,$2,$3)',[p.id,`campaign-invoice-${i.status}`,`${i.id} · ${i.amount_paid}/${i.amount_due} ${i.currency.toUpperCase()}`]);
  });return true;
 }
 async function cancel(c,p,actor,confirmed){
  if(actor.role!=='admin'||confirmed!==true)fail('Solo el administrador puede confirmar la baja solicitada por el cliente',403);
  const b=await billing(c,p.id);if(!p.campaign_snapshot.config.renewal||!b.publication_end||now()<new Date(new Date(b.publication_end).getTime()-15*86400000))fail('La cancelación se habilita 15 días antes de finalizar el período inicial',409);if(b.cancel_requested_at)return;
  if(b.renewal_schedule_id){let s=await stripe.subscriptionSchedules.retrieve(b.renewal_schedule_id);if(s.status==='not_started')await stripe.subscriptionSchedules.cancel(s.id,{}, {idempotencyKey:`campaign-cancel:${p.id}`});else{if(s.status==='active')s=await stripe.subscriptionSchedules.release(s.id,{}, {idempotencyKey:`campaign-release:${p.id}`});if(s.released_subscription)await stripe.subscriptions.update(R.idOf(s.released_subscription),{cancel_at_period_end:true},{idempotencyKey:`campaign-cancel-renewal:${p.id}`});}}
  await c.query('UPDATE partner_campaign_billing SET cancel_requested_at=NOW() WHERE client_id=$1',[p.id]);await notify(c,p,'cancellation','cancellation');
 }
 async function run(){
  const ids=(await db.query("SELECT p.id FROM partner_clients p JOIN partner_campaign_billing b ON b.client_id=p.id WHERE p.offer='campaign' AND p.deleted_at IS NULL AND p.blocked_at IS NULL AND b.first_paid_at IS NOT NULL AND b.status<>'ended' ORDER BY b.checked_at LIMIT 100")).rows;
  let errors=0;
  for(const item of ids)try{await transaction(async c=>{const p=await row(c,item.id),b=await billing(c,p.id),cfg=p.campaign_snapshot.config;await c.query('UPDATE partner_campaign_billing SET checked_at=NOW() WHERE client_id=$1',[p.id]);const end=p.expires_at||b.publication_end;if(end&&new Date(end)<=now()){if(!cfg.renewal||b.cancel_requested_at){await c.query('UPDATE experiences SET is_published=FALSE WHERE id=$1',[p.experience_id]);await c.query("UPDATE partner_campaign_billing SET status='ended' WHERE client_id=$1",[p.id]);await notify(c,p,'ended','ended');}else await suspend(c,p,b);return;}await ensureRenewal(c,p,b);if(cfg.renewal&&b.publication_end&&!b.cancel_requested_at&&new Date(b.publication_end)-now()<=15*86400000&&new Date(b.publication_end)>now())await notify(c,p,'renewal_notice',`notice:${sec(b.publication_end)}`);});}catch(e){errors++;console.error('[partner campaign worker]',item.id,e.code||e.message);}
  await mail.flush();return {processed:ids.length,errors};
 }
 async function subscriptionEvent(event){
  const value=event.data.object;
  if(value.metadata?.itc_partner_campaign!=='v1')return false;
  await transaction(async c=>{
   const p=await row(c,value.metadata.partner_id);if(!R.isCampaign(p)||p.deleted_at)return;
   const b=await billing(c,p.id);if(!b?.first_paid_at)return;
   if((await c.query('SELECT 1 FROM partner_campaign_events WHERE event_id=$1',[event.id])).rowCount)return;
   const sub=await stripe.subscriptions.retrieve(value.id);
   if(sub.id!==b.initial_subscription_id&&sub.id!==b.renewal_subscription_id){
    if(!b.renewal_schedule_id)return;const schedule=await stripe.subscriptionSchedules.retrieve(b.renewal_schedule_id);
    if(R.idOf(schedule.subscription||schedule.released_subscription)!==sub.id)return;
    await c.query('UPDATE partner_campaign_billing SET renewal_subscription_id=$2 WHERE client_id=$1',[p.id,sub.id]);b.renewal_subscription_id=sub.id;
   }
   if(R.idOf(sub.customer)!==b.customer_id||sub.metadata.revision_id!==p.campaign_revision_id)fail('Suscripción no vinculada al acuerdo',409);
   if(sub.id===b.initial_subscription_id){
    const paid=Number((await c.query("SELECT count(*) AS n FROM partner_campaign_invoices WHERE client_id=$1 AND phase='initial' AND status='paid'",[p.id])).rows[0].n);
    if(!['active','trialing'].includes(sub.status)&&paid<p.campaign_snapshot.config.installments){await suspend(c,p,b);await notify(c,p,'payment_failed',`subscription:${sub.id}:${sub.status}`);}
   }else if(sub.cancel_at_period_end||['canceled','unpaid','incomplete_expired'].includes(sub.status)){
    if(sub.cancel_at_period_end||sub.status==='canceled'){await c.query('UPDATE partner_campaign_billing SET cancel_requested_at=COALESCE(cancel_requested_at,NOW()) WHERE client_id=$1',[p.id]);await notify(c,p,'cancellation','cancellation');}
    if(['unpaid','incomplete_expired'].includes(sub.status)||new Date(p.expires_at)<=now())await suspend(c,p,b);
   }
   await c.query('INSERT INTO partner_campaign_events(event_id) VALUES($1) ON CONFLICT DO NOTHING',[event.id]);
  });return true;
 }
 async function dispatch(event){const o=event.data.object;if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&o.metadata?.itc_partner_campaign==='v1'){await confirm(o.id);await mail.flush();return true;}if(['customer.subscription.updated','customer.subscription.deleted'].includes(event.type)){const handled=await subscriptionEvent(event);if(handled)await mail.flush();return handled;}if(['invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.marked_uncollectible','invoice.voided'].includes(event.type)){const handled=await invoiceEvent(event);if(handled)await mail.flush();return handled;}return false;}
 async function handle(event){
  try{const handled=await dispatch(event);if(handled)await db.query("INSERT INTO partner_campaign_webhook_audit(event_id,event_type,client_id,status) VALUES($1,$2,$3,'processed') ON CONFLICT(event_id) DO UPDATE SET status='processed',error_code=NULL,attempts=partner_campaign_webhook_audit.attempts+1,updated_at=NOW()",[event.id,event.type,event.data.object.metadata?.partner_id||null]);return handled;}
  catch(error){try{await db.query("INSERT INTO partner_campaign_webhook_audit(event_id,event_type,client_id,status,error_code) VALUES($1,$2,$3,'failed',$4) ON CONFLICT(event_id) DO UPDATE SET status='failed',error_code=$4,attempts=partner_campaign_webhook_audit.attempts+1,updated_at=NOW()",[event.id,event.type,event.data.object.metadata?.partner_id||null,String(error.code||error.type||'VERIFICATION_FAILED').slice(0,100)]);}catch{}throw error;}
 }
 async function detail(id){const b=(await db.query('SELECT * FROM partner_campaign_billing WHERE client_id=$1',[id])).rows[0];if(!b)return null;const invoices=(await db.query('SELECT * FROM partner_campaign_invoices WHERE client_id=$1 ORDER BY period_start DESC,updated_at DESC',[id])).rows;return {...b,invoices,initial_paid:invoices.filter(i=>i.phase==='initial'&&i.status==='paid').length,can_cancel:!!b.publication_end&&!b.cancel_requested_at&&now()>=new Date(new Date(b.publication_end).getTime()-15*86400000)};}
 return {checkout,confirm,activate,handle,run,detail,cancel,ensureRenewal};
}
let instance;function service(){if(!instance){const crm=require('./partner-crm.service');instance=createService({db:require('../config/db'),transaction:crm.transaction,stripe:require('./stripe.service').partnerCampaignClient(),campaigns:require('./partner-campaign.service').service(),mail:require('./partner-email.service'),link:crm.link});}return instance;}
module.exports={createService,service,validInvoice,validCheckout};
