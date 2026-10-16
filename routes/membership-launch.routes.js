const router=require('express').Router(),service=require('../services/membership-launch.service');
const {requireUserAuth}=require('../middleware/auth'),security=require('../middleware/security-rate-limit');
router.post('/checkout',requireUserAuth,security.limit('launch-checkout',5,60,security.user),async(req,res,next)=>{
 try{res.json({success:true,...await service.checkout({userId:req.user.id,token:req.body?.invitation,consent:req.body?.consent,baseUrl:require('../utils/appReturn').publicBaseUrl(req)})});}catch(e){next(e);}
});
module.exports=router;
