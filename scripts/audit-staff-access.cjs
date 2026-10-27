// Publication diagnostic only. Every query executes in a READ ONLY transaction.
const {Client}=require('pg');
(async()=>{
 const c=new Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,database:process.env.DB_DATABASE,password:process.env.DB_PASSWORD,ssl:false});
 await c.connect();
 try{
  await c.query('BEGIN READ ONLY');
  const pattern=process.env.AUDIT_STAFF_EMAIL;
  const clients=(await c.query(`SELECT p.id,p.business_name,p.form_status,p.experience_id,p.activated_at,p.expires_at,
    e.title AS linked_title,e.is_published AS linked_published,
    (SELECT jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'published',x.is_published)) FROM experiences x
     WHERE regexp_replace(lower(x.title),'[^a-z0-9]','','g') LIKE '%'||regexp_replace(lower(p.business_name),'[^a-z0-9]','','g')||'%') AS matching_experiences
    FROM partner_clients p LEFT JOIN experiences e ON e.id=p.experience_id
    WHERE p.deleted_at IS NULL AND p.business_name ~* $1 ORDER BY p.business_name`,[pattern])).rows;
  const drafts=(await c.query(`SELECT d.id,d.owner_id,d.status,d.experience_id,d.payload->>'title' AS title,e.is_published,d.created_at,d.updated_at
    FROM experience_drafts d LEFT JOIN experiences e ON e.id=d.experience_id
    WHERE d.payload->>'title' ~* $1 ORDER BY d.updated_at DESC`,[pattern])).rows;
  const experiences=(await c.query('SELECT id,title,access,is_published FROM experiences ORDER BY title')).rows;
  console.log(JSON.stringify({clients,drafts,experiences},null,2));
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}
})().catch(e=>{console.error(e.code||'PUBLICATION_AUDIT_FAILED');process.exitCode=1;});
