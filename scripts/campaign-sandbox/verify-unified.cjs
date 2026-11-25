// Read production as an authorized administrator; all mutations target test mode only.
const {execFileSync}=require('node:child_process'),jwt=require('jsonwebtoken'),db=require('../../config/db');
const BASE='https://itc-backend-1031252664334.us-east1.run.app',PROJECT='itc-developer-502721';
const g=args=>execFileSync('gcloud',[...args,'--project',PROJECT,'--quiet'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
(async()=>{
 const actor=(await db.query("SELECT id,session_version FROM admins WHERE role='admin' AND is_active ORDER BY id LIMIT 1")).rows[0];if(!actor)throw Error('Active administrator required');
 const key=g(['secrets','versions','access','latest','--secret','JWT_SECRET']);
 const token=jwt.sign({id:actor.id,sv:Number(actor.session_version||0),type:'staff'},key,{expiresIn:'120s',algorithm:'HS256'});
 async function api(path,body,partner){const r=await fetch(BASE+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:partner?'Partner '+partner:'Bearer '+token},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const result=await r.json();if(!r.ok)throw Error(`Unified test ${path}: ${r.status} ${result.message||''}`);return result;}
 const real=await api('/api/partners/campaigns');
 const prefix='/api/partner-campaign-test';
 const status=await api(prefix+'/partners/communications/status');if(!status.sandbox||status.delivery!=='captured')throw Error('Test mode isolation failed');
 const campaigns=await api(prefix+'/partners/campaigns');if(!campaigns.length)throw Error('Verified test campaign missing');
 const clients=await api(prefix+'/partners/clients');const sample=clients.find(c=>c.business_name==='[Técnica] Negocio de prueba');if(!sample)throw Error('Technical test client missing');
 const client=await api(prefix+'/partners/clients/'+sample.id);
 if(!client.link.startsWith('https://itc-panel-1031252664334.us-east1.run.app/partner?campaignTest=1#'))throw Error('Invitation points outside the administrator panel');
 const partner=client.link.split('#')[1];
 const view=await api(prefix+'/partners/access',null,partner);if(view.offer!=='campaign'||view.payment_test!==true)throw Error('Public test invitation mode mismatch');
 const mails=await api(prefix+'/partners/communications/mail');
 console.log(JSON.stringify({sameAdministratorLogin:true,productionCampaigns:real.length,testCampaigns:campaigns.length,testInvitation:'current administrator panel',capturedEmails:mails.length,publicInvitation:'verified',productionWrites:0}));
})().catch(e=>{console.error(String(e.message).replace(/eyJ[A-Za-z0-9_.-]+/g,'[redacted-token]'));process.exitCode=1;}).finally(()=>db.end());
