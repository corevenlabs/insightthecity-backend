const router=require('express').Router();
const db=require('../config/db');
const controller=require('../controllers/experiences.controller');
const mail=require('../services/partner-email.service');
const {layout,paragraph}=require('../services/email-layout');
const {escape}=require('../services/membership-email.service');
router.use(require('../middleware/staff').requireStaff('admin','executive'));
const security=require('../middleware/security-rate-limit');
router.use(security.limit('experience-drafts',180,60,security.staff));
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
const payload=body=>{
 if(!body || typeof body.title!=='string' || !body.title.trim() || body.title.length>200)fail(400,'Agrega un título de hasta 200 caracteres');
 if(body.isPublished===true || body.is_published===true)fail(403,'La publicación requiere aprobación del administrador');
 const socialError=controller.validateSocialLinks(body);
 if(socialError)fail(400,socialError);
 return {...body,isPublished:false,is_published:false};
};
const lock=async(c,req)=>{
 if(!/^[a-f0-9-]{36}$/i.test(req.params.id))fail(404,'Borrador no encontrado');
 const row=(await c.query('SELECT * FROM experience_drafts WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
 if(!row || (req.admin.role!=='admin' && row.owner_id!==req.admin.id))fail(404,'Borrador no encontrado');
 return row;
};
const activity=(c,row,actor,kind)=>c.query('INSERT INTO experience_draft_activity(draft_id,actor_id,kind) VALUES($1,$2,$3)',[row.id,actor.id,kind]);
const withActivity=async(c,row)=>({...row,activity:(await c.query('SELECT e.id,e.kind,e.created_at,a.name AS actor_name FROM experience_draft_activity e LEFT JOIN admins a ON a.id=e.actor_id WHERE e.draft_id=$1 ORDER BY e.id DESC LIMIT 50',[row.id])).rows});
router.get('/',wrap(async(req,res)=>{
 const rows=(await db.query("SELECT d.*,a.name AS owner_name FROM experience_drafts d LEFT JOIN admins a ON a.id=d.owner_id WHERE ($1::boolean OR d.owner_id=$2) ORDER BY (d.status='pending') DESC,d.updated_at DESC LIMIT 200",[req.admin.role==='admin',req.admin.id])).rows;
 res.json(rows);
}));
router.post('/',wrap(async(req,res)=>{
 const body=payload(req.body),c=await db.connect();
 try{
  await c.query('BEGIN');
  const row=(await c.query('INSERT INTO experience_drafts(owner_id,payload) VALUES($1,$2) RETURNING *',[req.admin.id,body])).rows[0];
  await activity(c,row,req.admin,'created');
  await c.query('COMMIT');res.status(201).json(row);
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}));
const transaction=fn=>wrap(async(req,res)=>{
 const c=await db.connect();let result;
 try{await c.query('BEGIN');const row=await lock(c,req);result=await withActivity(c,await fn(c,row,req));await c.query('COMMIT');}
 catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 if(req.path.endsWith('/submit'))await mail.flush().catch(()=>console.error('[draft review] mail retry pending'));
 res.json(result);
});
router.get('/:id',transaction(async(c,row)=>row));
router.put('/:id',transaction(async(c,row,req)=>{
 if(row.status!=='draft' && !(row.status==='pending' && req.admin.role==='admin'))fail(409,'Solo el administrador puede editar durante la revisión. Las experiencias aprobadas se editan desde su publicación');
 const updated=(await c.query('UPDATE experience_drafts SET payload=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[row.id,payload(req.body)])).rows[0];
 await activity(c,row,req.admin,'saved');
 return updated;
}));
router.post('/:id/submit',transaction(async(c,row,req)=>{
 if(row.status!=='draft')fail(409,'Este borrador ya fue enviado o aprobado');
 const b={...row.payload,isPublished:true};
 const error=controller.validateLocation(b)||controller.validateGallery(b,true)||controller.validateMemberBenefit(b,b.access==='premium');
 if(error)fail(400,error);
 const updated=(await c.query("UPDATE experience_drafts SET status='pending',review_version=review_version+1,updated_at=NOW() WHERE id=$1 RETURNING *",[row.id])).rows[0];
 await activity(c,row,req.admin,'submitted');
 const admins=(await c.query("SELECT id,email,language FROM admins WHERE role='admin' AND is_active")).rows;
 const link=`${(process.env.PANEL_PUBLIC_URL||'https://itc-panel-1031252664334.us-east1.run.app').replace(/\/$/,'')}/borradores/${row.id}`;
 for(const admin of admins){
  const language=['es','en','pt'].includes(admin.language)?admin.language:'es';
  const words={es:['Experiencia pendiente de aprobación','Responsable','Revisar experiencia','Aviso interno','Contactar a ITC Club'],en:['Experience pending approval','Account manager','Review experience','Internal notice','Contact ITC Club'],pt:['Experiência pendente de aprovação','Responsável','Revisar experiência','Aviso interno','Contatar ITC Club']}[language];
  const [title,ownerLabel,reviewLabel,help,supportLabel]=words;
  const text=`${row.payload.title}\n${ownerLabel}: ${req.admin.name}\n${reviewLabel}: ${link}`;
  const message={subject:`ITC Club · ${title}`,text,html:layout({lang:language,title,banner:'lifecycle-alert-en-v1.png',content:paragraph(row.payload.title)+paragraph(`${ownerLabel}: ${req.admin.name}`)+`<p><a href="${escape(link)}" style="color:#FDDD56">${escape(reviewLabel)}</a></p>`,help,supportLabel})};
  await c.query('INSERT INTO partner_mail(dedupe_key,recipient,message) VALUES($1,$2,$3) ON CONFLICT(dedupe_key) DO NOTHING',[`experience-review:${row.id}:${updated.review_version}:${admin.id}`,admin.email,message]);
 }
 return updated;
}));
router.post('/:id/return',transaction(async(c,row,req)=>{
 if(req.admin.role!=='admin')fail(403,'Solo el administrador puede devolver borradores');
 if(row.status!=='pending')fail(409,'Este borrador no está pendiente de aprobación');
 const updated=(await c.query("UPDATE experience_drafts SET status='draft',review_note=$2,reviewed_by=$3,updated_at=NOW() WHERE id=$1 RETURNING *",[row.id,String(req.body.note||'').slice(0,2000),req.admin.id])).rows[0];
 await activity(c,row,req.admin,'returned');
 return updated;
}));
router.post('/:id/approve',transaction(async(c,row,req)=>{
 if(req.admin.role!=='admin')fail(403,'Solo el administrador puede aprobar y publicar');
 if(!['draft','pending'].includes(row.status))fail(409,'Este borrador ya fue aprobado');
 const content=Object.hasOwn(req.body || {},'payload')?payload(req.body.payload):row.payload;
 let status=200,result;
 const capture={status(value){status=value;return this;},json(value){result=value;return this;}};
 await controller.createExperience({...req,body:{...content,id:`draft-${row.id}`,isPublished:true},experienceConnection:c},capture,e=>{throw e;});
 if(status>=400 || !result?.id)fail(status>=400?status:500,result?.message||'No se pudo publicar');
 const updated=(await c.query("UPDATE experience_drafts SET status='approved',payload=$4,experience_id=$2,reviewed_by=$3,updated_at=NOW() WHERE id=$1 RETURNING *",[row.id,result.id,req.admin.id,content])).rows[0];
 if(Object.hasOwn(req.body || {},'payload'))await activity(c,row,req.admin,'saved');
 await activity(c,row,req.admin,'published');
 return updated;
}));
module.exports=router;
