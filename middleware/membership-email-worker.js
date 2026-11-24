const crypto=require('crypto');
const {isScheduler}=require('./scheduler-auth');
const reject=res=>res.status(401).json({success:false,message:'No autorizado'});
module.exports=(req,res,next)=>{
 const expected=crypto.createHmac('sha256',process.env.JWT_SECRET).update('membership-email-worker-v1').digest('hex');
 const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
 // GitHub Actions (backup) uses the HMAC; Cloud Scheduler uses a Google identity token.
 if(/^[a-f0-9]{64}$/.test(supplied))return crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))?next():reject(res);
 if(!supplied.includes('.'))return reject(res);
 return isScheduler(req,'/api/payment/launch/retry-emails').then(ok=>ok?next():reject(res));
};
