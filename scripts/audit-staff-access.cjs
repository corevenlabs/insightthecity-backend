// Every query runs inside a PostgreSQL READ ONLY transaction.
const {Client}=require('pg');
(async()=>{
 const connection=new Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,database:process.env.DB_DATABASE,password:process.env.DB_PASSWORD,ssl:false});
 await connection.connect();
 try{
  await connection.query('BEGIN READ ONLY');
  const accounts=(await connection.query('SELECT id,email,role,is_active FROM admins WHERE lower(trim(email))=lower(trim($1))',[process.env.AUDIT_STAFF_EMAIL])).rows;
  console.log(JSON.stringify({staffAccounts:accounts}));
  for(const account of accounts){
   const summary=(await connection.query(`SELECT form_status,payment_status,blocked_at IS NOT NULL AS blocked,activated_at IS NOT NULL AS activated,COUNT(*)::int AS clients FROM partner_clients WHERE owner_id=$1 AND deleted_at IS NULL GROUP BY form_status,payment_status,blocked_at IS NOT NULL,activated_at IS NOT NULL ORDER BY form_status,payment_status`,[account.id])).rows;
   console.log(JSON.stringify({staffId:account.id,assignedClientStates:summary}));
   const recent=(await connection.query(`SELECT p.kind AS action,COUNT(*)::int AS actions,MAX(p.created_at) AS latest FROM partner_activity p WHERE p.actor_id=$1 AND p.created_at>NOW()-INTERVAL '7 days' GROUP BY p.kind ORDER BY MAX(p.created_at) DESC`,[account.id])).rows;
   console.log(JSON.stringify({staffId:account.id,recentActions:recent}));
  }
  await connection.query('COMMIT');
 }catch(error){await connection.query('ROLLBACK');throw error;}
 finally{await connection.end();}
})().catch(error=>{console.error(error.code||'STAFF_AUDIT_FAILED',error.code==='42703'?error.message:'No se pudo completar la consulta de solo lectura');process.exitCode=1;});
