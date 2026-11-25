// Only an isolated local database; all Stripe calls and SMTP are replaced below.
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
if(process.env.DB_DATABASE!=='itc_crm_test'||!['localhost','127.0.0.1'].includes(process.env.DB_HOST))throw Error('Use isolated local itc_crm_test');
process.env.JWT_SECRET='campaign-local-test-only';process.env.PANEL_PUBLIC_URL='https://panel.example.invalid';
const db=require('../config/db');const crm=require('../services/partner-crm.service');
const R=require('../services/partner-campaign-rules');
let clock=new Date('2027-01-10T12:00:00Z');const now=()=>new Date(clock);
const maps={products:new Map(),prices:new Map(),coupons:new Map(),customers:new Map(),sessions:new Map(),invoices:new Map(),subscriptions:new Map(),schedules:new Map()};
const calls=[];const idem=new Map();let serial=0;
const copy=x=>structuredClone(x);
function store(kind,prefix){return {async create(data,opts={}){if(idem.has(opts.idempotencyKey))return copy(idem.get(opts.idempotencyKey));const v={id:`${prefix}_${++serial}`,livemode:false,active:true,...copy(data)};if(kind==='prices'&&data.recurring)v.recurring.interval_count=1;if(kind==='coupons'){assert.ok(Array.from(data.name).length<=40,'Stripe coupon names allow at most 40 characters');v.valid=true;}maps[kind].set(v.id,v);if(opts.idempotencyKey)idem.set(opts.idempotencyKey,v);calls.push([kind,data]);return copy(v);},async retrieve(id,params){assert.ok(maps[kind].has(id),`${kind} ${id} exists`);const value=copy(maps[kind].get(id));if(kind==='coupons'&&!params?.expand?.includes('applies_to'))delete value.applies_to;return value;}};}
const stripe={products:store('products','prod'),prices:store('prices','price'),coupons:store('coupons','coupon'),customers:store('customers','cus'),checkout:{sessions:store('sessions','cs')},subscriptions:store('subscriptions','sub'),subscriptionSchedules:store('schedules','sched'),invoices:store('invoices','in')};
const rawSession=stripe.checkout.sessions.create;
stripe.checkout.sessions.create=async(data,opts)=>{const price=maps.prices.get(data.line_items[0].price),off=data.discounts?maps.coupons.get(data.discounts[0].coupon).amount_off:0;const s=await rawSession({...data,amount_subtotal:price.unit_amount,amount_total:price.unit_amount-off,currency:price.currency,total_details:{amount_discount:off,amount_shipping:0,amount_tax:0},url:'https://checkout.stripe.com/local',status:'open',payment_status:'unpaid'},opts);return s;};
stripe.checkout.sessions.expire=async id=>{maps.sessions.get(id).status='expired';};
stripe.invoices.list=({customer,status})=>({async *[Symbol.asyncIterator](){for(const i of maps.invoices.values())if(i.customer===customer&&i.status===status)yield copy(i);}});
stripe.subscriptionSchedules.create=async(data,opts)=>{if(idem.has(opts?.idempotencyKey))return copy(idem.get(opts.idempotencyKey));const s={id:`sched_${++serial}`,status:data.from_subscription?'active':'not_started',...copy(data),phases:data.phases||[{start_date:Math.floor(now()/1000)}]};maps.schedules.set(s.id,s);if(opts?.idempotencyKey)idem.set(opts.idempotencyKey,s);calls.push(['schedule',data]);return copy(s);};
stripe.subscriptionSchedules.update=async(id,data)=>{const start=data.phases[0].start_date,s=maps.schedules.get(id);Object.assign(s,copy(data));s.phases[0].end_date=Math.floor(R.addMonths(start*1000,data.phases[0].duration.interval_count)/1000);return copy(s);};
stripe.subscriptionSchedules.cancel=async id=>{maps.schedules.get(id).status='canceled';return copy(maps.schedules.get(id));};
stripe.subscriptionSchedules.release=async id=>{const s=maps.schedules.get(id);s.status='released';s.released_subscription=s.subscription;return copy(s);};
stripe.subscriptions.update=async(id,data)=>Object.assign(maps.subscriptions.get(id),data);
const sent=new Map(),mail={BASE:()=> 'https://panel.example.invalid',queue:async(c,m)=>{if(!sent.has(m.key))sent.set(m.key,m);},flush:async()=>{}};
const campaigns=require('../services/partner-campaign.service').createService({db,transaction:crm.transaction,stripe,now});
const billing=require('../services/partner-campaign-billing').createService({db,transaction:crm.transaction,stripe,campaigns,mail,link:p=>'https://panel.example.invalid/partner#'+p.id,now});
require('../services/partner-campaign.service').service=()=>campaigns;
require('../services/partner-campaign-billing').service=()=>billing;
require('../services/password-reset-mail.service').isConfigured=()=>false;
const config=(extra={})=>({name:'Community Partners',mode:'installments',currency:'usd',normalPriceCents:20000,priceCents:14000,installments:4,publicationMonths:4,publicationStart:'publication',renewal:true,renewalPriceCents:20000,termsTitle:'Commercial terms',termsContent:'Four monthly installments; publication starts on approval.',termsApproved:true,...extra});
let admin,executive,live,p;
async function getClient(id){return (await db.query('SELECT * FROM partner_clients WHERE id=$1',[id])).rows[0];}
async function pay(client){
 const s=maps.sessions.get(client.stripe_session_id),meta={...s.metadata},start=Math.floor(now()/1000),subscription=client.campaign_snapshot.config.mode==='installments';
 const i={id:`in_${++serial}`,customer:s.customer,currency:'usd',livemode:false,subtotal:client.campaign_snapshot.config.normalPriceCents,total_discount_amounts:[{amount:client.campaign_snapshot.config.normalPriceCents-client.amount_cents}],total:client.amount_cents,amount_due:client.amount_cents,amount_paid:client.amount_cents,amount_remaining:0,status:'paid',paid:true,metadata:meta,lines:{data:[{quantity:1,price:client.campaign_snapshot.price_id,period:{start,end:Math.floor(R.addMonths(now(),1)/1000)}}],has_more:false},status_transitions:{paid_at:start},hosted_invoice_url:'https://invoice.stripe.com/local'};
 if(subscription){const sub={id:`sub_${++serial}`,customer:s.customer,metadata:meta,status:'active',default_payment_method:'pm_local',latest_invoice:i};i.subscription=sub.id;maps.subscriptions.set(sub.id,sub);s.subscription=sub;}else{s.invoice=i;s.payment_intent={payment_method:'pm_local'};}
 maps.invoices.set(i.id,i);s.status='complete';s.payment_status='paid';return i;
}
test('campaign lifecycle with isolated PostgreSQL and fake Stripe',async t=>{
 await db.query('TRUNCATE admins,experiences,partner_campaign_events CASCADE');
 admin=(await db.query("INSERT INTO admins(email,name,password_hash,role) VALUES('admin@local.invalid','Admin','unused','admin') RETURNING *")).rows[0];
 executive=(await db.query("INSERT INTO admins(email,name,password_hash,role) VALUES('exec@local.invalid','Executive','unused','executive') RETURNING *")).rows[0];
 await t.test('draft does not call Stripe and executive cannot create or activate',async()=>{
  const n=calls.length;live=await campaigns.create({config:config()},admin);assert.equal(calls.length,n);assert.equal(live.status,'draft');
  await assert.rejects(()=>campaigns.create({config:config()},executive),e=>e.status===403);
  await assert.rejects(()=>campaigns.publish(live.id,{confirm:false,expectedVersion:1},admin));
  assert.equal(calls.length,n);
 });
 await t.test('HTTP routes enforce staff permissions and preview never sends email or calls Stripe',async()=>{
  const express=require('express'),jwt=require('jsonwebtoken'),app=express();app.use(express.json());app.use('/partners',require('../routes/partner.routes'));app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const url=`http://127.0.0.1:${server.address().port}/partners/campaigns`,headers=actor=>({'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign({id:actor.id,type:'staff'},process.env.JWT_SECRET)});
   assert.equal((await fetch(url,{headers:headers(executive)})).status,403);
   assert.equal((await fetch(url+'/available',{headers:headers(executive)})).status,200);
   const n=calls.length,m=sent.size;const preview=await fetch(url+'/preview',{method:'POST',headers:headers(admin),body:JSON.stringify({config:config(),kind:'payment'})});assert.equal(preview.status,200);assert.match((await preview.json()).subject,/Community Partners/);assert.equal(calls.length,n);assert.equal(sent.size,m);
   assert.equal((await fetch(url+'/not-a-uuid',{headers:headers(admin)})).status,400);
   assert.equal((await fetch(url+'/worker',{method:'POST',headers:headers(executive)})).status,401);
  }finally{await new Promise(r=>server.close(r));}
 });
 await t.test('activation creates normal price, automatic discount, independent renewal and retries without duplicates',async()=>{
  live=await campaigns.publish(live.id,{confirm:true,expectedVersion:1},admin);const n=calls.length;
  const r=live.revisions[0];assert.equal(r.state,'ready');assert.equal(maps.prices.get(r.price_id).unit_amount,20000);assert.equal(maps.coupons.get(r.coupon_id).amount_off,6000);assert.equal(maps.coupons.get(r.coupon_id).duration,'forever');
  await campaigns.publish(live.id,{confirm:true,expectedVersion:1},admin);assert.equal(calls.length,n);
  await assert.rejects(()=>db.query("UPDATE partner_campaign_revisions SET config='{}' WHERE id=$1",[r.id]),/immutable/);
 });
 await t.test('campaign client ignores caller amount; legacy client prices unchanged',async()=>{
  const created=await crm.create({campaign_id:live.id,business_name:'Campaign shop',contact_name:'Alice',email:'alice@local.invalid',amount_cents:1},admin);p=await getClient(created.id);assert.equal(p.amount_cents,14000);assert.equal(p.offer,'campaign');assert.equal(p.terms_snapshot.en.content,config().termsContent);
  const legacy=await crm.create({category:'partner',offer:'founding',payment_method:'stripe',business_name:'Legacy',contact_name:'Bob',email:'bob@local.invalid'},admin);assert.equal(legacy.amount_cents,30000);assert.equal(legacy.campaign_billing,null);
  await assert.rejects(()=>db.query('UPDATE partner_clients SET amount_cents=1 WHERE id=$1',[p.id]),/immutable/);
 });
 await t.test('existing agreement survives a new version and campaign pause',async()=>{
  live=await campaigns.save(live.id,{expectedVersion:1,config:config({priceCents:15000})},admin);live=await campaigns.publish(live.id,{confirm:true,expectedVersion:2},admin);
  live=await campaigns.action(live.id,{action:'pause'},admin);assert.equal((await campaigns.available()).length,0);assert.equal((await getClient(p.id)).amount_cents,14000);
  await assert.rejects(()=>crm.create({campaign_id:live.id,business_name:'Blocked',contact_name:'B',email:'b@local.invalid'},admin),e=>e.status===409);
  p.form_status='invited';await campaigns.allowInvitation(db,p);
  live=await campaigns.action(live.id,{action:'resume'},admin);
 });
 await t.test('checkout price verified and first confirmed payment creates exactly four monthly installments',async()=>{
  await db.query("UPDATE partner_clients SET form_status='invited' WHERE id=$1",[p.id]);p=await getClient(p.id);
  await db.query("INSERT INTO partner_acceptances(client_id,stage,language,signer_name,signer_email,document) VALUES($1,'commercial','en','Alice',$2,$3)",[p.id,p.email,JSON.stringify({invitationVersion:p.link_version})]);
  const result=await crm.transaction(c=>billing.checkout(c,p));assert.match(result.url,/checkout.stripe.com/);p=await getClient(p.id);
  const session=maps.sessions.get(p.stripe_session_id);assert.equal(session.amount_total,14000);assert.equal(session.allow_promotion_codes,undefined);
  const n=calls.length;await crm.transaction(c=>billing.checkout(c,p));assert.equal(calls.length,n);
  await pay(p);await billing.confirm(p.stripe_session_id);await billing.confirm(p.stripe_session_id);
  const b=await billing.detail(p.id);assert.equal(b.initial_paid,1);assert.equal(b.publication_start,null);const schedule=maps.schedules.get(b.initial_schedule_id);assert.equal(schedule.end_behavior,'cancel');assert.equal(schedule.phases[0].duration.interval_count,4);assert.equal(sent.size,1);
 });
 await t.test('publication starts on approval even a month after billing and schedules regular renewal after publication period',async()=>{
  clock=new Date('2027-02-10T12:00:00Z');await db.query("INSERT INTO experiences(id,title,category,is_published) VALUES('campaign-place','Place','FOOD',false)");p=await getClient(p.id);
  await crm.transaction(c=>billing.activate(c,p,'campaign-place',admin));p=await getClient(p.id);await db.query("UPDATE experiences SET is_published=TRUE WHERE id='campaign-place'");
  const b=await billing.detail(p.id);assert.equal(b.publication_end.toISOString(),'2027-06-10T12:00:00.000Z');
  assert.equal((await billing.run()).errors,0);const current=await billing.detail(p.id),s=maps.schedules.get(current.renewal_schedule_id);assert.equal(s.start_date,Math.floor(b.publication_end/1000));assert.equal(s.phases[0].items[0].price,p.campaign_snapshot.renewal_price_id);
 });
 let invoice;
 await t.test('failed installment hides published profile and prevents manual republication',async()=>{
  const b=await billing.detail(p.id),first=maps.invoices.get(b.initial_invoice_id);invoice={...copy(first),id:'in_second',status:'open',paid:false,amount_paid:0,amount_remaining:14000,lines:{data:[{quantity:1,price:p.campaign_snapshot.price_id,period:{start:1802260800,end:1804680000}}]}};
  // The second installment starts one calendar month after the first.
  invoice.lines.data[0].period.start=Math.floor(new Date('2027-02-10T12:00:00Z')/1000);maps.invoices.set(invoice.id,invoice);
  await billing.handle({id:'evt_failed',type:'invoice.payment_failed',data:{object:invoice}});assert.equal((await billing.detail(p.id)).status,'past_due');assert.equal((await db.query("SELECT is_published FROM experiences WHERE id='campaign-place'")).rows[0].is_published,false);
  await assert.rejects(()=>db.query("UPDATE experiences SET is_published=TRUE WHERE id='campaign-place'"),/suspended/);
 });
 await t.test('confirmed recovery restores only a previously published profile and sends one receipt on duplicate webhooks',async()=>{
  Object.assign(invoice,{status:'paid',paid:true,amount_paid:14000,amount_remaining:0});maps.invoices.set(invoice.id,invoice);const e={id:'evt_paid',type:'invoice.paid',data:{object:invoice}};
  await billing.handle(e);const n=sent.size;await billing.handle(e);assert.equal(sent.size,n);assert.equal((await billing.detail(p.id)).status,'active');assert.equal((await db.query("SELECT is_published FROM experiences WHERE id='campaign-place'")).rows[0].is_published,true);
  await billing.handle({id:'evt_stale_fail',type:'invoice.payment_failed',data:{object:{...invoice,status:'open'}}});assert.equal((await billing.detail(p.id)).status,'active');
 });
 await t.test('an administrative edit while suspended is never overwritten on payment recovery',async()=>{
  Object.assign(invoice,{status:'open',paid:false,amount_paid:0,amount_remaining:14000});await billing.handle({id:'evt_fail_edit',type:'invoice.payment_failed',data:{object:invoice}});
  await db.query("UPDATE experiences SET title='Edited by admin' WHERE id='campaign-place'");Object.assign(invoice,{status:'paid',paid:true,amount_paid:14000,amount_remaining:0});await billing.handle({id:'evt_paid_edit',type:'invoice.paid',data:{object:invoice}});
  const e=(await db.query("SELECT * FROM experiences WHERE id='campaign-place'")).rows[0];assert.equal(e.is_published,false);assert.equal(e.title,'Edited by admin');
  await db.query("UPDATE experiences SET is_published=TRUE WHERE id='campaign-place'");
 });
 await t.test('early cancellation in Stripe blocks incomplete commitment; paid invoice cannot bypass it',async()=>{
  const b=await billing.detail(p.id),sub=maps.subscriptions.get(b.initial_subscription_id);sub.status='canceled';await billing.handle({id:'evt_early_cancel',type:'customer.subscription.deleted',data:{object:sub}});
  assert.equal((await billing.detail(p.id)).status,'past_due');await billing.handle({id:'evt_paid_canceled',type:'invoice.paid',data:{object:invoice}});assert.equal((await billing.detail(p.id)).status,'past_due');
  sub.status='active';await billing.handle({id:'evt_paid_resumed',type:'invoice.paid',data:{object:invoice}});assert.equal((await billing.detail(p.id)).status,'active');
 });
 await t.test('fifth installment is rejected, unrelated member invoices are ignored',async()=>{
  const b=await billing.detail(p.id),extra={...copy(invoice),id:'in_excess',lines:{data:[{quantity:1,price:p.campaign_snapshot.price_id,period:{start:Math.floor(b.billing_end/1000),end:Math.floor(b.billing_end/1000)+86400}}]}};maps.invoices.set(extra.id,extra);
  await assert.rejects(()=>billing.handle({id:'evt_extra',type:'invoice.paid',data:{object:extra}}),/excede/);
  assert.equal(await billing.handle({id:'evt_member',type:'invoice.paid',data:{object:{id:'in_unknown',customer:'cus_member'}}}),false);
 });
 await t.test('cancellation window starts 15 days before end, cancels future renewal without changing installments',async()=>{
  p=await getClient(p.id);await assert.rejects(()=>crm.transaction(c=>billing.cancel(c,p,admin,true)),/15 días/);
  clock=new Date('2027-05-27T12:00:00Z');await billing.run();assert.ok([...sent.values()].some(m=>m.kind==='renewal_notice'));
  await assert.rejects(()=>crm.transaction(c=>billing.cancel(c,p,executive,true)),e=>e.status===403);
  await crm.transaction(c=>billing.cancel(c,p,admin,true));const b=await billing.detail(p.id);assert.equal(maps.schedules.get(b.renewal_schedule_id).status,'canceled');assert.equal(maps.schedules.get(b.initial_schedule_id).end_behavior,'cancel');
  clock=new Date('2027-06-11T12:00:00Z');await billing.run();assert.equal((await billing.detail(p.id)).status,'ended');assert.equal((await db.query("SELECT is_published FROM experiences WHERE id='campaign-place'")).rows[0].is_published,false);
 });
 await t.test('one-time campaign without renewal confirms once and never creates a subscription',async()=>{
  let single=await campaigns.create({config:config({mode:'one_time',installments:1,renewal:false,publicationMonths:2,publicationStart:'payment'})},admin);single=await campaigns.publish(single.id,{confirm:true,expectedVersion:1},admin);
  const created=await crm.create({campaign_id:single.id,business_name:'Single payment',contact_name:'S',email:'single@local.invalid'},admin);let customer=await getClient(created.id);
  await crm.action(customer.id,{action:'generate-link'},admin);customer=await getClient(customer.id);const token=crm.link(customer).split('#')[1];
  await assert.rejects(()=>crm.checkout(token,{accept:false,signerName:'S',language:'en'}),/Acepta/);
  const createSession=stripe.checkout.sessions.create;stripe.checkout.sessions.create=async(...args)=>{const v=await createSession(...args);v.amount_total+=1;return v;};
  await assert.rejects(()=>crm.checkout(token,{accept:true,signerName:'S',language:'en'}),/Stripe no confirmó/);const expired=await getClient(customer.id);assert.equal(maps.sessions.get(expired.stripe_session_id).status,'expired');assert.equal(expired.checkout_attempt,1);stripe.checkout.sessions.create=createSession;
  await crm.checkout(token,{accept:true,signerName:'S',language:'en'});assert.equal((await db.query("SELECT count(*) AS n FROM partner_acceptances WHERE client_id=$1 AND stage='commercial'",[customer.id])).rows[0].n,'1');customer=await getClient(customer.id);const count=maps.schedules.size;const invoice=await pay(customer),session=maps.sessions.get(customer.stripe_session_id);Object.assign(invoice,{status:'open',paid:false,amount_paid:0,amount_remaining:14000});session.payment_status='unpaid';
  await billing.handle({id:'evt_first_failed',type:'invoice.payment_failed',data:{object:invoice}});assert.equal((await billing.detail(customer.id)).status,'pending');assert.ok([...sent.values()].some(m=>m.clientId===customer.id&&m.kind==='payment_failed'));
  Object.assign(invoice,{status:'paid',paid:true,amount_paid:14000,amount_remaining:0});session.payment_status='paid';await billing.confirm(customer.stripe_session_id);const b=await billing.detail(customer.id);assert.equal(b.initial_subscription_id,null);assert.equal(maps.schedules.size,count);assert.equal(b.publication_end.toISOString(),'2027-08-11T12:00:00.000Z');
 });
 await t.test('regular renewal invoice extends paid dates and issues a deduplicated receipt without promotional discount',async()=>{
  let offer=await campaigns.create({config:config({mode:'one_time',installments:1,publicationMonths:2,publicationStart:'payment'})},admin);offer=await campaigns.publish(offer.id,{confirm:true,expectedVersion:1},admin);
  const created=await crm.create({campaign_id:offer.id,business_name:'Renewal business',contact_name:'R',email:'renewal@local.invalid'},admin);let customer=await getClient(created.id);
  await crm.action(customer.id,{action:'generate-link'},admin);customer=await getClient(customer.id);await crm.checkout(crm.link(customer).split('#')[1],{accept:true,signerName:'R',language:'en'});customer=await getClient(customer.id);await pay(customer);await billing.confirm(customer.stripe_session_id);
  await db.query("INSERT INTO experiences(id,title,category,is_published) VALUES('renewal-place','Renewal place','FOOD',false)");await crm.transaction(c=>billing.activate(c,customer,'renewal-place',admin));await db.query("UPDATE experiences SET is_published=TRUE WHERE id='renewal-place'");await billing.run();
  let b=await billing.detail(customer.id);const schedule=maps.schedules.get(b.renewal_schedule_id);clock=new Date(b.publication_end);const start=Math.floor(now()/1000),end=Math.floor(R.addMonths(now(),1)/1000),meta={itc_partner_campaign:'v1',partner_id:customer.id,revision_id:customer.campaign_revision_id,phase:'renewal'};
  const sub={id:'sub_regular_renewal',customer:b.customer_id,metadata:meta,status:'active'};maps.subscriptions.set(sub.id,sub);schedule.subscription=sub.id;schedule.status='active';
  const invoice={id:'in_regular_renewal',customer:b.customer_id,livemode:false,currency:'usd',subtotal:20000,total:20000,amount_due:20000,amount_paid:20000,amount_remaining:0,status:'paid',paid:true,total_discount_amounts:[],metadata:meta,subscription:sub.id,lines:{data:[{quantity:1,price:customer.campaign_snapshot.renewal_price_id,period:{start,end}}],has_more:false},status_transitions:{paid_at:start}};maps.invoices.set(invoice.id,invoice);
  const event={id:'evt_regular_renewal',type:'invoice.paid',data:{object:invoice}};await billing.handle(event);const n=sent.size;await billing.handle(event);assert.equal(sent.size,n);assert.equal((await getClient(customer.id)).expires_at.toISOString(),'2027-09-11T12:00:00.000Z');assert.equal((await billing.detail(customer.id)).invoices.filter(i=>i.phase==='renewal').length,1);
  customer=await getClient(customer.id);await crm.transaction(c=>billing.cancel(c,customer,admin,true));assert.equal(sub.cancel_at_period_end,true);assert.equal((await getClient(customer.id)).expires_at.toISOString(),'2027-09-11T12:00:00.000Z');
 });
 await t.test('campaign delivery leaves legacy pending emails untouched',async()=>{
  const transport=require('../services/password-reset-mail.service'),emails=require('../services/partner-email.service');
  const previous={isConfigured:transport.isConfigured,send:transport.send};const delivered=[];
  const legacy=(await db.query("SELECT id FROM partner_clients WHERE offer!='campaign' LIMIT 1")).rows[0];assert.ok(legacy);
  await db.query("UPDATE partner_mail SET status='sent' WHERE status!='sent'");
  for(const [id,key] of [[legacy.id,'legacy-pending-proof'],[p.id,'campaign-pending-proof']])await db.query("INSERT INTO partner_mail(client_id,dedupe_key,recipient,message) VALUES($1,$2,'local@example.invalid',$3)",[id,key,JSON.stringify({subject:key,text:'Local test'})]);
  transport.isConfigured=()=>true;transport.send=async m=>delivered.push(m.subject);
  try{await emails.flush(undefined,{campaignOnly:true});assert.deepEqual(delivered,['campaign-pending-proof']);assert.equal((await db.query("SELECT status FROM partner_mail WHERE dedupe_key='legacy-pending-proof'")).rows[0].status,'pending');}
  finally{Object.assign(transport,previous);}
 });
 await t.test('inline test exchange uses isolated staff and disables separate test login',async()=>{
  const env={...process.env};const jwt=require('jsonwebtoken'),express=require('express'),gateway=require('../services/partner-campaign-test-gateway');
  process.env.PARTNER_CAMPAIGNS_SANDBOX='true';process.env.PARTNER_CAMPAIGNS_INLINE_TESTS='true';process.env.CAMPAIGN_TEST_ADMIN_EMAIL=admin.email;
  const app=express();app.use(express.json());app.use(require('../services/partner-campaign-sandbox').restrict);app.post('/api/partners/campaign-test-session',gateway.exchange);app.use((e,req,res,next)=>res.status(500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const assertion=extra=>jwt.sign({purpose:'campaign-test-gateway',actorId:123,role:'admin',...extra},process.env.JWT_SECRET,{algorithm:'HS256',issuer:gateway.LIVE_BASE,audience:gateway.TEST_BASE,expiresIn:'60s'});
  const post=token=>fetch(base+'/api/partners/campaign-test-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assertion:token})});
  try{assert.equal((await fetch(base+'/api/auth/login',{method:'POST'})).status,404);assert.equal((await post('invalid')).status,401);assert.equal((await post(assertion({role:'executive'}))).status,403);const response=await post(assertion({}));assert.equal(response.status,200);const claims=jwt.verify((await response.json()).token,process.env.JWT_SECRET);assert.equal(claims.id,admin.id);assert.equal(claims.gatewayActor,123);assert.equal(claims.type,'staff');assert.ok(claims.exp-claims.iat<=90);}
  finally{await new Promise(r=>server.close(r));for(const k of ['PARTNER_CAMPAIGNS_SANDBOX','PARTNER_CAMPAIGNS_INLINE_TESTS','CAMPAIGN_TEST_ADMIN_EMAIL'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}
 });
 await t.test('sandbox captures branded mail and PDFs without SMTP; inbox requires admin authentication',async()=>{
  const previous=process.env.PARTNER_CAMPAIGNS_SANDBOX;process.env.PARTNER_CAMPAIGNS_SANDBOX='true';
  let server;
  try{
   const emails=require('../services/partner-email.service');await emails.queue(db,{clientId:p.id,key:'sandbox-mail-proof',to:'client@example.invalid',kind:'payment',data:{client:await getClient(p.id),url:'https://panel.example.invalid/partner#test'}});await emails.flush();
   const captured=(await db.query("SELECT * FROM partner_mail WHERE dedupe_key='sandbox-mail-proof'")).rows[0];assert.ok(captured.sandbox_captured_at);assert.equal(captured.status,'pending');assert.equal(captured.attempts,0);assert.match(captured.message.html,/ITC/);
   await assert.rejects(()=>require('../services/password-reset-mail.service').send({to:'client@example.invalid'}),e=>e.code==='SANDBOX_EMAIL_CAPTURE_ONLY');
   const app=require('express')();app.use('/sandbox',require('../routes/partner-campaign-sandbox.routes'));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/sandbox`,jwt=require('jsonwebtoken');
   assert.equal((await fetch(base+'/mail')).status,401);const headers={Authorization:'Bearer '+jwt.sign({id:admin.id,type:'staff'},process.env.JWT_SECRET)};
   const response=await fetch(base+'/mail/'+captured.id,{headers});assert.equal(response.status,200);assert.match((await response.json()).subject,/Community Partners/);
   const events=await (await fetch(base+'/status',{headers})).json();assert.equal(events.sandbox,true);assert.equal(events.delivery,'captured');assert.ok(events.events.some(e=>e.status==='processed'));assert.doesNotMatch(JSON.stringify(events),/sk_test_|whsec_/);
  }finally{if(server)await new Promise(r=>server.close(r));if(previous===undefined)delete process.env.PARTNER_CAMPAIGNS_SANDBOX;else process.env.PARTNER_CAMPAIGNS_SANDBOX=previous;}
 });
});
after(()=>db.end());
