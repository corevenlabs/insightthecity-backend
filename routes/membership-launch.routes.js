const payment=require('../services/membership-launch-payment.service');
const router=require('express').Router(),service=require('../services/membership-launch.service');
const {requireUserAuth}=require('../middleware/auth'),security=require('../middleware/security-rate-limit');
router.post('/preview',security.limit('launch-preview',30,60,security.ip),async(req,res,next)=>{
 try{res.set('Cache-Control','no-store').json({success:true,...await service.preview(req.body?.invitation),checkoutMode:require('../services/membership-payment-link.service').enabled()?'payment_link':'embedded',publishableKey:require('../services/membership-payment-link.service').enabled()?null:payment.publishableKey()});}catch(e){next(e);}
});
router.post('/register',security.limit('launch-register',10,3600,security.ip),async(req,res,next)=>{
 try{res.set('Cache-Control','no-store').json({success:true,...await service.register({token:req.body?.invitation,email:req.body?.email,name:req.body?.name,password:req.body?.password,acceptLegal:req.body?.acceptLegal,consent:req.body?.consent})});}catch(e){next(e);}
});
router.post('/payment-link',requireUserAuth,security.limit('launch-payment-link',5,60,security.user),async(req,res,next)=>{try{res.set('Cache-Control','no-store').json({success:true,...await require('../services/membership-payment-link.service').checkout({userId:req.user.id,token:req.body?.invitation,acceptLegal:req.body?.acceptLegal,consent:req.body?.consent})});}catch(e){next(e);}});
router.post('/checkout',requireUserAuth,security.limit('launch-checkout',5,60,security.user),async(req,res,next)=>{
 try{res.json({success:true,...await service.checkout({userId:req.user.id,token:req.body?.invitation,consent:req.body?.consent,baseUrl:require('../utils/appReturn').publicBaseUrl(req)})});}catch(e){next(e);}
});
for(const [path,method,max,seconds] of [['prepare',payment.prepare,10,60],['complete',payment.complete,30,60],['resend',payment.resend,5,86400]]){
 router.post('/'+path,requireUserAuth,security.limit('launch-'+path,max,seconds,security.user),async(req,res,next)=>{
  try{res.set('Cache-Control','no-store').json({success:true,...await method({userId:req.user.id,token:req.body?.invitation,acceptLegal:req.body?.acceptLegal,consent:req.body?.consent})});}catch(e){next(e);}
 });
}
router.post('/retry-emails',require('../middleware/membership-email-worker'),async(req,res,next)=>{
 try{res.json({success:true,...await require('../services/subscription.service').retryPendingConfirmations(),paymentNotices:await require('../services/membership-payment-alert.service').retry()});}catch(e){next(e);}
});
module.exports=router;
