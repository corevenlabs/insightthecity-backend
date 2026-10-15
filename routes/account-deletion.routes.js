const router=require('express').Router();
const service=require('../services/account-deletion.service');
const crypto=require('crypto');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const publicLimit=require('../middleware/security-rate-limit').limit('web-deletion-ip',60,60);
const emailLimit=require('../middleware/security-rate-limit').limit('web-deletion-email',10,3600,require('../middleware/security-rate-limit').email);
router.use((req,res,next)=>{res.set('Cache-Control','no-store').set('Referrer-Policy','no-referrer').set('X-Content-Type-Options','nosniff');next();});
const jsonOnly=(req,res,next)=>req.is('application/json')?next():res.sendStatus(415);
router.post('/request-code',publicLimit,jsonOnly,emailLimit,wrap(async(req,res)=>{
 res.json(await require('../services/web-account-deletion.service').requestCode(req.body?.email,req.body?.language));
}));
router.post('/verify-code',publicLimit,jsonOnly,wrap(async(req,res)=>{
 const result=await require('../services/web-account-deletion.service').verifyCode(req.body?.challenge,req.body?.code);
 res.status(result?200:400).json(result||{success:false});
}));
router.post('/confirm',publicLimit,jsonOnly,wrap(async(req,res)=>{
 const result=await require('../services/web-account-deletion.service').confirm(req.body?.proof,req.body?.accept);
 res.status(result?202:400).json(result||{success:false});
}));
router.post('/process',require('../middleware/partner-rate-limit')(12),async(req,res,next)=>{
  const supplied=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,''));
  const expected=Buffer.from(service.workerToken());
  if(supplied.length!==expected.length || !crypto.timingSafeEqual(supplied,expected)) return res.sendStatus(401);
  try { await service.tick(); res.json({ok:true}); } catch(e){next(e);}
});
router.get('/',require('../middleware/staff').requireStaff('admin'),async(req,res,next)=>{
  try {res.set('Cache-Control','no-store').json((await require('../config/db').query("SELECT id,user_id,status,stripe_done,data_done,photos_done,attempts,last_error,requested_at,next_attempt_at,completed_at,alerted_at FROM account_deletions ORDER BY requested_at DESC LIMIT 100")).rows);} catch(e){next(e);}
});
module.exports=router;
