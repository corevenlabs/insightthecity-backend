const router=require('express').Router(),db=require('../config/db');
router.use(require('../middleware/staff').requireStaff('admin'));
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
router.get('/status',wrap(async(_req,res)=>{
 const count=(await db.query("SELECT count(*) AS count FROM partner_mail m JOIN partner_clients p ON p.id=m.client_id WHERE p.offer='campaign' AND m.sandbox_captured_at IS NOT NULL")).rows[0];
 const events=(await db.query('SELECT * FROM partner_campaign_webhook_audit ORDER BY updated_at DESC LIMIT 50')).rows;
 const sandbox=require('../services/partner-campaign-sandbox').enabled();
 let taxEnabled=sandbox?process.env.CAMPAIGN_SANDBOX_TAX_ENABLED==='true':false;
 let stripeConnected=true;if(!sandbox)try{taxEnabled=(await require('../services/stripe.service').partnerCampaignClient().tax.settings.retrieve()).status==='active';}catch{stripeConnected=false;}
 res.json({sandbox,delivery:sandbox?'captured':require('../services/password-reset-mail.service').isConfigured()?'enabled':'pending',stripe:sandbox?'test':'live',stripeConnected,taxEnabled,webhookConfigured:!!process.env.PARTNER_STRIPE_WEBHOOK_SECRET,captured:Number(count.count),events});
}));
router.get('/mail',wrap(async(req,res)=>{
 const id=req.query.clientId||null;
 const rows=(await db.query("SELECT m.id,m.client_id,m.recipient,m.message->>'subject' AS subject,m.status,m.sandbox_captured_at,m.created_at,p.business_name FROM partner_mail m LEFT JOIN partner_clients p ON p.id=m.client_id WHERE p.offer='campaign' AND ($1::uuid IS NULL OR m.client_id=$1) ORDER BY m.created_at DESC LIMIT 100",[id])).rows;res.json(rows);
}));
router.get('/mail/:id',wrap(async(req,res)=>{
 const row=(await db.query("SELECT m.* FROM partner_mail m JOIN partner_clients p ON p.id=m.client_id WHERE m.id=$1 AND p.offer='campaign'",[req.params.id])).rows[0];if(!row)return res.sendStatus(404);
 const {html,text,subject,attachments=[]}=row.message;
 res.json({id:row.id,recipient:row.recipient,html,text,subject,created_at:row.created_at,attachments:attachments.map((a,index)=>({filename:a.filename,index}))});
}));
router.get('/mail/:id/attachments/:index',wrap(async(req,res)=>{
 const row=(await db.query("SELECT m.message FROM partner_mail m JOIN partner_clients p ON p.id=m.client_id WHERE m.id=$1 AND p.offer='campaign'",[req.params.id])).rows[0];const index=Number(req.params.index),attachment=Number.isSafeInteger(index)&&index>=0?row?.message.attachments?.[index]:null;if(!attachment)return res.sendStatus(404);
 res.type('application/pdf').attachment(String(attachment.filename).replace(/[^a-zA-Z0-9._-]/g,'_')).send(Buffer.from(attachment.content,'base64'));
}));
module.exports=router;
