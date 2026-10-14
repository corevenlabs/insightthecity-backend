const router=require('express').Router();
const service=require('../services/account-deletion.service');
const crypto=require('crypto');
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
