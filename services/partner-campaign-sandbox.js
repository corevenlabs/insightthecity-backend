const enabled=()=>process.env.PARTNER_CAMPAIGNS_SANDBOX==='true';
const ORIGIN='https://itc-campaigns-test-backend-1031252664334.us-east1.run.app';
function validate(env){
 if(env.PARTNER_CAMPAIGNS_SANDBOX!=='true')return;
 if(env.DB_DATABASE!=='itc_campaigns_test'||env.DB_USER!=='itc_campaigns_test')throw Error('Sandbox requires its isolated database and database role');
 if(!/^sk_test_/.test(env.PARTNER_STRIPE_SECRET_KEY||'')||env.STRIPE_SECRET_KEY!==env.PARTNER_STRIPE_SECRET_KEY)throw Error('Sandbox requires matching test keys only');
 if(env.PUBLIC_BASE_URL!==ORIGIN||env.PANEL_PUBLIC_URL!=='https://itc-campaigns-test-panel-1031252664334.us-east1.run.app')throw Error('Sandbox origin mismatch');
 if(env.SMTP_HOST||env.SMTP_PASSWORD||env.RESEND_API_KEY||env.APPLE_TEAM_ID)throw Error('Live delivery and Apple configuration are not allowed in campaign sandbox');
}
function restrict(req,res,next){
 if(!enabled())return next();
 res.set('X-ITC-Environment','campaign-sandbox');
 const allowed=['/health','/api/auth','/api/staff','/api/partners','/api/experience-drafts','/api/experiences','/api/uploads','/api/legal','/business','/email-assets','/brand-assets','/uploads','/api/payment/launch/retry-emails'];
 if(!allowed.some(p=>req.path===p||req.path.startsWith(p+'/')))return res.status(404).json({message:'Este servicio está dedicado a las pruebas de campañas.'});
 next();
}
module.exports={enabled,validate,restrict,ORIGIN};
