const jwt=require('jsonwebtoken');
const {Readable}=require('node:stream');
const TEST_BASE='https://itc-campaigns-test-backend-1031252664334.us-east1.run.app';
const LIVE_BASE='https://itc-backend-1031252664334.us-east1.run.app';
const LIVE_PANEL='https://itc-panel-1031252664334.us-east1.run.app';
const PREFIX='/api/partner-campaign-test';
const allowed=['/partners/campaigns','/partners/clients','/partners/owners','/partners/access','/partners/communications','/experience-drafts','/experiences','/uploads'];
function targetPath(input){
 const decoded=decodeURIComponent(input||'/');
 if(decoded.includes('\\')||/[\r\n]/.test(decoded)||decoded.split(/[/?]/).includes('..'))throw Object.assign(Error('Ruta de prueba inválida'),{status:400});
 const path=decoded.split('?')[0];
 if(!allowed.some(p=>path===p||path.startsWith(p+'/'))||path.includes('/worker')||path.includes('/gateway'))throw Object.assign(Error('Ruta fuera del flujo de campañas'),{status:404});
 return input;
}
function createGateway({secret=()=>process.env.PARTNER_CAMPAIGNS_TEST_JWT_SECRET,fetcher=fetch,now=()=>Date.now()}={}){
 const tokens=new Map();
 async function session(actor){
  const key=`${actor.id}:${actor.session_version||0}`,cached=tokens.get(key);if(cached?.until>now())return cached.token;
  const signing=secret();if(!signing)throw Object.assign(Error('La conexión de pruebas aún no está configurada'),{status:503});
  const assertion=jwt.sign({purpose:'campaign-test-gateway',actorId:actor.id,role:'admin'},signing,{algorithm:'HS256',issuer:LIVE_BASE,audience:TEST_BASE,expiresIn:'60s'});
  const response=await fetcher(TEST_BASE+'/api/partners/campaign-test-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assertion}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Object.assign(Error('No se pudo conectar el modo de prueba. Tu sesión administrativa sigue activa.'),{status:502});
  const data=await response.json();if(!data.token)throw Object.assign(Error('Respuesta de pruebas inválida'),{status:502});
  if(tokens.size>100)tokens.clear();tokens.set(key,{token:data.token,until:now()+45000});return data.token;
 }
 return async function gateway(req,res,next){try{
  const suffix=targetPath(req.url),publicForm=suffix.split('?')[0].startsWith('/partners/access');
  let authorization;
  if(publicForm){if(!/^Partner [A-Za-z0-9_.-]+$/.test(req.headers.authorization||''))return res.status(401).json({message:'Invitación de prueba requerida'});authorization=req.headers.authorization;}
  else{if(req.admin?.role!=='admin')return res.status(403).json({message:'Solo el administrador puede probar campañas'});authorization='Bearer '+await session(req.admin);}
  const headers={Authorization:authorization,Accept:req.headers.accept||'application/json'};
  for(const h of ['content-type','accept-language'])if(req.headers[h])headers[h]=req.headers[h];
  let body;
  if(!['GET','HEAD'].includes(req.method)){
   if((req.headers['content-type']||'').includes('application/json'))body=JSON.stringify(req.body||{});
   else body=req;
  }
  const response=await fetcher(TEST_BASE+'/api'+suffix,{method:req.method,headers,body,...(body===req?{duplex:'half'}:{}),signal:AbortSignal.timeout(90000)});
  if(response.status===401&&!publicForm){tokens.clear();return res.status(502).json({message:'La conexión de pruebas se actualizó. Vuelve a intentarlo; tu sesión sigue activa.'});}
  res.status(response.status).set('Cache-Control','no-store');
  for(const h of ['content-type','content-disposition','content-range','retry-after'])if(response.headers.get(h))res.set(h,response.headers.get(h));
  if(response.body)Readable.fromWeb(response.body).on('error',next).pipe(res);else res.end();
 }catch(e){next(e);}};
}
async function exchange(req,res,next){try{
 if(process.env.PARTNER_CAMPAIGNS_SANDBOX!=='true'||process.env.PARTNER_CAMPAIGNS_INLINE_TESTS!=='true')return res.sendStatus(404);
 const token=req.body?.assertion;if(typeof token!=='string'||token.length>4000)return res.sendStatus(401);
 let p;try{p=jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256'],issuer:LIVE_BASE,audience:TEST_BASE,maxAge:'60s'});}catch{return res.sendStatus(401);}
 if(p.purpose!=='campaign-test-gateway'||p.role!=='admin'||!Number.isSafeInteger(p.actorId))return res.sendStatus(403);
 const admin=(await require('../config/db').query("SELECT id,session_version FROM admins WHERE email=$1 AND role='admin' AND is_active",[process.env.CAMPAIGN_TEST_ADMIN_EMAIL||'soporte@insightthecity.com'])).rows[0];
 if(!admin)return res.status(503).json({message:'Administrador de pruebas no disponible'});
 const delegated=jwt.sign({id:admin.id,type:'staff',sv:Number(admin.session_version||0),gatewayActor:p.actorId},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'90s'});
 res.set('Cache-Control','no-store').json({token:delegated});
 }catch(e){next(e);}}
module.exports={createGateway,exchange,targetPath,TEST_BASE,LIVE_BASE,LIVE_PANEL,PREFIX};
