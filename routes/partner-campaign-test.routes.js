const router=require('express').Router();
const {createGateway}=require('../services/partner-campaign-test-gateway');
const admin=require('../middleware/staff').requireStaff('admin');
const gateway=createGateway();
router.use(require('../middleware/partner-rate-limit')(240));
router.use((req,res,next)=>req.path.startsWith('/partners/access')?next():admin(req,res,next));
router.use(gateway);
module.exports=router;
