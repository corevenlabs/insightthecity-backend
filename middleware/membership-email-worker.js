const crypto=require('crypto');
module.exports=(req,res,next)=>{
 const expected=crypto.createHmac('sha256',process.env.JWT_SECRET).update('membership-email-worker-v1').digest('hex');
 const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
 if(!/^[a-f0-9]{64}$/.test(supplied)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return res.status(401).json({success:false,message:'No autorizado'});
 next();
};
