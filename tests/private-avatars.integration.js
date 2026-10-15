const {test,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
if(process.env.DB_DATABASE!=='itc_crm_test'||process.env.DB_HOST!=='127.0.0.1')throw Error('Isolated DB only');
process.env.UPLOAD_DRIVER='local';
const db=require('../config/db');after(()=>db.end());
test('existing avatar is copied privately before public removal; download uses owner and account deletion removes bytes',async()=>{
 await db.query(fs.readFileSync('database/schema.sql','utf8'));
 await db.query(fs.readFileSync('database/security-hardening.sql','utf8'));await db.query(fs.readFileSync('database/private-avatars.sql','utf8'));
 const user=(await db.query('INSERT INTO users(email) VALUES($1) RETURNING id',[`avatar-${Date.now()}@example.test`])).rows[0];
 const dir=`uploads/avatars/${user.id}`,bytes=Buffer.from([255,216,255,0]);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(`${dir}/test.jpg`,bytes);
 await db.query('UPDATE users SET avatar_url=$2 WHERE id=$1',[user.id,`http://localhost:3000/uploads/avatars/${user.id}/test.jpg`]);
 try{
 await require('../scripts/migrate-private-avatars').migrate(true);
 assert.equal(fs.existsSync(`${dir}/test.jpg`),false);
 const stored=(await db.query('SELECT * FROM user_avatars WHERE user_id=$1',[user.id])).rows[0];assert.ok(stored.bytes.equals(bytes));assert.equal(stored.legacy_key,null);
 const res={headers:{},set(k,v){this.headers[k]=v;return this;},json(v){this.body=v;return this;},sendStatus(v){this.status=v;return this;}};
 await require('../controllers/profile.controller').getAvatar({user:{id:user.id},query:{format:'json',id:'another-user'}},res,e=>{throw e;});
 assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.body.dataUrl,`data:image/jpeg;base64,${bytes.toString('base64')}`);
 const foreign={...res,body:null};await require('../controllers/profile.controller').getAvatar({user:{id:-1},query:{format:'json'}},foreign,e=>{throw e;});assert.equal(foreign.status,404);
 await db.query('DELETE FROM users WHERE id=$1',[user.id]);assert.equal((await db.query('SELECT * FROM user_avatars WHERE user_id=$1',[user.id])).rowCount,0);
 }finally{await db.query('DELETE FROM users WHERE id=$1',[user.id]);fs.rmSync(dir,{recursive:true,force:true});}
});
