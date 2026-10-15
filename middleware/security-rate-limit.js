const crypto=require('crypto');
const db=require('../config/db');
function key(scope,identity,window){
 return crypto.createHmac('sha256',process.env.JWT_SECRET).update(`rate:${scope}:${window}:${String(identity).slice(0,512)}`).digest('hex');
}
function limit(scope,max,seconds,identity=req=>req.ip||req.socket?.remoteAddress||'unknown'){
 return async(req,res,next)=>{
  try{
   const now=Date.now(),window=Math.floor(now/(seconds*1000));
   const reset=new Date((window+1)*seconds*1000);
   const row=(await db.query(`INSERT INTO security_rate_limits(key_hash,count,reset_at) VALUES($1,1,$2)
    ON CONFLICT(key_hash) DO UPDATE SET count=LEAST(security_rate_limits.count+1,$3) RETURNING count`,[key(scope,identity(req),window),reset,max+1])).rows[0];
   if(row.count>max){res.set('Retry-After',String(Math.max(1,Math.ceil((reset.getTime()-now)/1000))));return res.status(429).json({success:false,message:'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.'});}
   next();
  }catch{next(Object.assign(Error('La protección de solicitudes no está disponible temporalmente'),{status:503}));}
 };
}
const email=req=>String(req.body?.email||'').trim().toLowerCase().slice(0,254);
const user=req=>`user:${req.user.id}`;
const staff=req=>`staff:${req.admin.id}`;
const auth=(scope,perAccount=20)=>[limit(scope+':ip',1000,900),limit(scope+':account',perAccount,900,email)];
module.exports={limit,auth,email,user,staff};
