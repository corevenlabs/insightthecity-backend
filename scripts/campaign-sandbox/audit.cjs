// Read-only diagnostics: permission names and database-role flags, never credentials.
const {execFileSync}=require('node:child_process');
const project='itc-developer-502721';
const g=args=>execFileSync('gcloud',[...args,'--project',project,'--quiet'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
async function audit(){
 const token=g(['auth','print-access-token']);
 const permissions=['secretmanager.secrets.get','secretmanager.secrets.create','secretmanager.secrets.setIamPolicy','secretmanager.versions.add','secretmanager.versions.access','iam.serviceAccounts.create','iam.serviceAccounts.get','iam.serviceAccounts.setIamPolicy','resourcemanager.projects.setIamPolicy','cloudsql.instances.connect','storage.buckets.create','storage.buckets.get','storage.buckets.setIamPolicy','run.services.create','run.services.update','run.services.setIamPolicy','cloudscheduler.jobs.create','cloudscheduler.jobs.update'];
 const response=await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({permissions}),signal:AbortSignal.timeout(20000)});
 const result=await response.json();console.log(JSON.stringify({permissionAudit:response.status,granted:result.permissions||[]}));
 const db=new(require('pg').Client)({host:'127.0.0.1',port:5432,user:'itc_app',database:'postgres',password:g(['secrets','versions','access','latest','--secret','DB_PASSWORD'])});
 try{await db.connect();const role=(await db.query('SELECT rolcreaterole,rolcreatedb,rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];console.log(JSON.stringify({maintenanceDatabaseRole:role}));}catch(e){console.log(JSON.stringify({maintenanceDatabaseError:e.code||'CONNECTION_FAILED'}));}finally{await db.end();}
}
module.exports={audit};
