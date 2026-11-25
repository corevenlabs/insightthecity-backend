const R=require('./partner-campaign-rules');
const {fail}=require('./partner-rules');
const admin=actor=>{if(actor?.role!=='admin')fail('Solo el administrador puede gestionar campañas',403);};
function createService({db,transaction,stripe,now=()=>new Date()}){
 async function get(c,id,lock=false){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))fail('Identificador de campaña inválido',400);const row=(await c.query(`SELECT * FROM partner_campaigns WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0];if(!row)fail('Campaña no encontrada',404);return row;}
 async function detail(id,actor){admin(actor);const row=await get(db,id);row.revisions=(await db.query('SELECT * FROM partner_campaign_revisions WHERE campaign_id=$1 ORDER BY version DESC',[id])).rows;return row;}
 async function list(actor){admin(actor);return (await db.query('SELECT * FROM partner_campaigns ORDER BY updated_at DESC')).rows;}
 async function available(){return (await db.query("SELECT c.id,r.id AS revision_id,r.config FROM partner_campaigns c JOIN partner_campaign_revisions r ON r.id=c.active_revision_id WHERE c.status='active' AND r.state='ready'")).rows.filter(r=>R.available(r.config,now())).map(r=>({id:r.id,revision_id:r.revision_id,config:r.config}));}
 async function create(input,actor){admin(actor);const config=R.config(input.config);const row=(await db.query('INSERT INTO partner_campaigns(draft_config,created_by,updated_by) VALUES($1,$2,$2) RETURNING *',[JSON.stringify(config),actor.id])).rows[0];return detail(row.id,actor);}
 async function save(id,input,actor){admin(actor);await transaction(async c=>{const row=await get(c,id,true);if(row.status==='archived')fail('La campaña está archivada',409);if(input.expectedVersion!==row.draft_version)fail('La campaña cambió. Actualiza antes de guardar',409);const config=R.config(input.config);if(require('util').isDeepStrictEqual(row.draft_config,config))return;await c.query('UPDATE partner_campaigns SET draft_config=$2,draft_version=draft_version+1,updated_by=$3,updated_at=NOW() WHERE id=$1',[id,JSON.stringify(config),actor.id]);});return detail(id,actor);}
 async function publish(id,input,actor){
  admin(actor);if(input.confirm!==true)fail('Confirma el resumen de cobros, renovación y términos',400);
  const revision=await transaction(async c=>{
   const row=await get(c,id,true);if(row.status==='archived')fail('La campaña está archivada',409);
   if(input.expectedVersion!==row.draft_version)fail('El borrador cambió. Revisa el resumen actualizado',409);
   R.publishable(row.draft_config,now());
   const r=(await c.query('INSERT INTO partner_campaign_revisions(campaign_id,version,config,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(campaign_id,version) DO UPDATE SET campaign_id=EXCLUDED.campaign_id RETURNING *',[id,row.draft_version,row.draft_config,actor.id])).rows[0];return r;
  });
  const meta={itc_partner_campaign:'v1',campaign_id:id,revision_id:revision.id};
  const key=type=>({idempotencyKey:`partner-campaign:${revision.id}:${type}`});
  if(!revision.product_id){const p=await stripe.products.create({name:revision.config.name,description:revision.config.description||undefined,metadata:meta},key('product'));revision.product_id=p.id;revision.livemode=p.livemode;await db.query('UPDATE partner_campaign_revisions SET product_id=$2,livemode=$3 WHERE id=$1',[revision.id,p.id,p.livemode]);}
  const c=revision.config;
  if(!revision.price_id){const p=await stripe.prices.create({product:revision.product_id,unit_amount:c.normalPriceCents,currency:c.currency,tax_behavior:'exclusive',...(c.mode==='installments'?{recurring:{interval:'month'}}:{}),metadata:meta},key('price'));revision.price_id=p.id;await db.query('UPDATE partner_campaign_revisions SET price_id=$2 WHERE id=$1',[revision.id,p.id]);}
  if(c.priceCents<c.normalPriceCents&&!revision.coupon_id){const coupon=await stripe.coupons.create({amount_off:c.normalPriceCents-c.priceCents,currency:c.currency,duration:c.mode==='installments'?'forever':'once',name:Array.from(`${c.name} · promotional offer`).slice(0,40).join(''),applies_to:{products:[revision.product_id]},metadata:meta},key('coupon-v2'));revision.coupon_id=coupon.id;await db.query('UPDATE partner_campaign_revisions SET coupon_id=$2 WHERE id=$1',[revision.id,coupon.id]);}
  if(c.renewal&&!revision.renewal_price_id){const p=await stripe.prices.create({product:revision.product_id,unit_amount:c.renewalPriceCents,currency:c.currency,tax_behavior:'exclusive',recurring:{interval:'month'},metadata:meta},key('renewal-price'));revision.renewal_price_id=p.id;await db.query('UPDATE partner_campaign_revisions SET renewal_price_id=$2 WHERE id=$1',[revision.id,p.id]);}
  await verify(revision);
  await transaction(async cx=>{const current=await get(cx,id,true);if(current.draft_version!==revision.version)fail('El borrador cambió mientras se preparaban los precios. Revisa y activa la versión actual.',409);await cx.query("UPDATE partner_campaign_revisions SET state='ready' WHERE id=$1",[revision.id]);await cx.query("UPDATE partner_campaigns SET status='active',active_revision_id=$2,updated_by=$3,updated_at=NOW() WHERE id=$1",[id,revision.id,actor.id]);});
  return detail(id,actor);
 }
 async function verify(r){
  const c=r.config,p=await stripe.prices.retrieve(r.price_id);
  if(!p.active||p.unit_amount!==c.normalPriceCents||p.currency!==c.currency||p.tax_behavior!=='exclusive'||R.idOf(p.product)!==r.product_id||p.livemode!==r.livemode||(c.mode==='installments'?(p.recurring?.interval!=='month'||p.recurring.interval_count!==1):!!p.recurring))fail('Stripe no confirmó el precio configurado. No se habilitará el pago.',409);
  if(r.coupon_id){const coupon=await stripe.coupons.retrieve(r.coupon_id);if(!coupon.valid||coupon.currency!==c.currency||coupon.amount_off!==c.normalPriceCents-c.priceCents||coupon.duration!==(c.mode==='installments'?'forever':'once')||!coupon.applies_to?.products?.includes(r.product_id)||coupon.livemode!==r.livemode)fail('Stripe no confirmó el descuento de la campaña',409);}
  if(c.renewal){const p=await stripe.prices.retrieve(r.renewal_price_id);if(!p.active||p.unit_amount!==c.renewalPriceCents||p.currency!==c.currency||R.idOf(p.product)!==r.product_id||p.recurring?.interval!=='month'||p.recurring.interval_count!==1||p.livemode!==r.livemode)fail('Stripe no confirmó el precio de renovación',409);}
 }
 async function action(id,input,actor){admin(actor);if(input.action==='activate')return publish(id,input,actor);if(input.action==='duplicate'){const old=await get(db,id);return create({config:{...old.draft_config,name:`${old.draft_config.name} (copia)`,termsApproved:false,startsAt:null,endsAt:null}},actor);}if(!['pause','resume','archive'].includes(input.action))fail('Acción de campaña inválida');await transaction(async c=>{const row=await get(c,id,true);if(input.action==='resume'&&!row.active_revision_id)fail('Activa primero una versión con precios verificados',409);if(row.status==='archived')fail('La campaña está archivada',409);await c.query('UPDATE partner_campaigns SET status=$2,updated_by=$3,updated_at=NOW() WHERE id=$1',[id,{pause:'paused',resume:'active',archive:'archived'}[input.action],actor.id]);});return detail(id,actor);}
 async function revision(c,campaignId){const row=(await c.query("SELECT r.* FROM partner_campaigns p JOIN partner_campaign_revisions r ON r.id=p.active_revision_id WHERE p.id=$1 AND p.status='active' AND r.state='ready'",[campaignId])).rows[0];if(!row||!R.available(row.config,now()))fail('La campaña no admite nuevas invitaciones en este momento',409);return row;}
 async function allowInvitation(c,row){if(!R.isCampaign(row)||row.form_status!=='not_sent')return;const campaign=await get(c,row.campaign_snapshot.campaign_id);if(campaign.status!=='active'||!R.available(row.campaign_snapshot.config,now()))fail('La campaña no admite nuevas invitaciones',409);}
 return {list,available,detail,create,save,publish,action,revision,verify,allowInvitation};
}
let instance;
function service(){if(!instance)instance=createService({db:require('../config/db'),transaction:require('./partner-crm.service').transaction,stripe:require('./stripe.service').partnerCampaignClient()});return instance;}
module.exports={createService,service};
