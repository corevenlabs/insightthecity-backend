require('../../services/partner-campaign-sandbox').validate(process.env);
if(process.env.DB_DATABASE!=='itc_campaigns_test')throw Error('Sandbox database required');
const db=require('../../config/db'),bcrypt=require('bcryptjs');
(async()=>{
 const email=process.env.CAMPAIGN_TEST_ADMIN_EMAIL,password=process.env.CAMPAIGN_TEST_ADMIN_PASSWORD;
 if(!email||!password||password.length<20)throw Error('Sandbox administrator credentials missing');
 const existing=(await db.query('SELECT id FROM admins WHERE email=$1',[email])).rows[0];
 if(!existing)await db.query("INSERT INTO admins(email,name,password_hash,role,language) VALUES($1,'Administrador de pruebas',$2,'admin','es')",[email,await bcrypt.hash(password,12)]);
 console.log('Sandbox administrator ready; password is stored only in Secret Manager.');
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>db.end());
