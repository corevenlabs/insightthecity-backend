const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const enabled=process.env.DB_DATABASE==='itc_crm_test';
test('migración idempotente y contexto aislado por usuario en PostgreSQL',{skip:!enabled},async()=>{
 const {Pool}=require('pg');const pool=new Pool({host:process.env.DB_HOST||'127.0.0.1',user:process.env.DB_USER,database:'itc_crm_test',port:5432,ssl:false});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // TEMP shadows the public table: never modify production/customer chat rows.
  await client.query("CREATE TEMP TABLE chat_messages (id SERIAL PRIMARY KEY,user_id INTEGER,role TEXT,message TEXT,created_at TIMESTAMPTZ DEFAULT NOW()) ON COMMIT DROP");
  const migration=fs.readFileSync(require('node:path').join(__dirname,'../database/chat-catalog-context.sql'),'utf8');
  await client.query(migration);await client.query(migration);
  const id=require.resolve('../config/db');require.cache[id]={id,filename:id,loaded:true,exports:{query:(...args)=>client.query(...args)}};
  const chat=require('../services/chat.service');
  const context={version:1,filters:{topics:['food'],region:'NY'},shown:['experience:test']};
  await chat.saveMessage(42,'user','Comida en NY');await chat.saveMessage(42,'assistant','Opciones de comida',context);
  await chat.saveMessage(72,'assistant','Otra conversación',{version:1,filters:{topics:['museums']}});
  const history=await chat.getHistory(42,50);assert.equal(history.length,2);assert.deepEqual(history[1].catalog_context,context);assert.ok(history.every(x=>x.message!=='Otra conversación'));
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});
