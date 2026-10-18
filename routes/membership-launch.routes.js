const router=require('express').Router(),service=require('../services/membership-launch.service');
const {requireUserAuth}=require('../middleware/auth'),security=require('../middleware/security-rate-limit');
router.post('/preview',security.limit('launch-preview',30,60,security.ip),async(req,res,next)=>{
 try{res.set('Cache-Control','no-store').json({success:true,...await service.preview(req.body?.invitation)});}catch(e){next(e);}
});
router.post('/register',security.limit('launch-register',10,3600,security.ip),async(req,res,next)=>{
 try{res.set('Cache-Control','no-store').json({success:true,...await service.register({token:req.body?.invitation,email:req.body?.email,name:req.body?.name,password:req.body?.password,acceptLegal:req.body?.acceptLegal})});}catch(e){next(e);}
});
router.post('/checkout',requireUserAuth,security.limit('launch-checkout',5,60,security.user),async(req,res,next)=>{
 try{res.json({success:true,...await service.checkout({userId:req.user.id,token:req.body?.invitation,consent:req.body?.consent,baseUrl:require('../utils/appReturn').publicBaseUrl(req)})});}catch(e){next(e);}
});
module.exports=router;
