require('dotenv').config();
const db=require('../config/db');
const {isProfileImage}=require('../controllers/profile.controller');
const uploads=require('../services/uploads.service');
const fs=require('fs/promises'),path=require('path');
async function migrate(apply=false){
 const rows=(await db.query(`SELECT u.id,u.avatar_url,a.legacy_key FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id WHERE u.avatar_url IS NOT NULL`)).rows;
 let moved=0,pending=0;
 for(const user of rows){
  try{
   let key=user.legacy_key;
   if(!user.avatar_url.startsWith('/api/users/me/avatar?')){
    const url=new URL(user.avatar_url);
    const prefix=process.env.UPLOAD_DRIVER==='gcs'?`/${process.env.GCS_BUCKET}/avatars/${user.id}/`:`/uploads/avatars/${user.id}/`;
    if(process.env.UPLOAD_DRIVER==='gcs' && url.origin!=='https://storage.googleapis.com')throw Error('Unexpected origin');
    if(!url.pathname.startsWith(prefix))throw Error('Unexpected avatar path');
    const name=url.pathname.slice(prefix.length);
    if(!/^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(name))throw Error('Unexpected filename');
    key=`avatars/${user.id}/${name}`;
    if(!apply){pending++;continue;}
    let bytes;
    if(process.env.UPLOAD_DRIVER==='gcs'){
     const object=require('../config/storage').bucket(process.env.GCS_BUCKET).file(key);
     const [meta]=await object.getMetadata();if(Number(meta.size)>5*1024*1024)throw Error('Oversized image');
     [bytes]=await object.download();
    }else bytes=await fs.readFile(path.join(__dirname,'..','uploads',key));
    const mime=bytes[0]===255?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'?'image/webp':'image/png';
    if(bytes.length>5*1024*1024||!isProfileImage({buffer:bytes,mimetype:mime}))throw Error('Invalid image');
    const c=await db.connect();
    try{
     await c.query('BEGIN');
     const current=(await c.query('SELECT avatar_url FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
     if(!current||current.avatar_url!==user.avatar_url){await c.query('ROLLBACK');continue;}
     const saved=(await c.query(`INSERT INTO user_avatars(user_id,bytes,mime,legacy_key) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id) DO UPDATE SET bytes=EXCLUDED.bytes,mime=EXCLUDED.mime,legacy_key=EXCLUDED.legacy_key,version=gen_random_uuid() RETURNING version,bytes`,[user.id,bytes,mime,key])).rows[0];
     if(!saved.bytes.equals(bytes))throw Error('Copy verification failed');
     await c.query('UPDATE users SET avatar_url=$2 WHERE id=$1',[user.id,`/api/users/me/avatar?v=${saved.version}`]);
     await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   }
   if(key && apply){
    await uploads.deletePrefix(`avatars/${user.id}`);
    if(process.env.UPLOAD_DRIVER==='gcs'){
      const [remaining]=await require('../config/storage').bucket(process.env.GCS_BUCKET).getFiles({prefix:`avatars/${user.id}/`,maxResults:1});
      if(remaining.length)throw Error('Public avatar cleanup not complete');
    }
    await db.query('UPDATE user_avatars SET legacy_key=NULL WHERE user_id=$1',[user.id]);moved++;
   }
  }catch{pending++;console.error('Avatar migration pending for user',user.id);}
 }
 console.log(JSON.stringify({applied:apply,moved,pending}));
 if(apply&&pending)throw Error('Some avatars require retry; public copies may remain');
}
if(require.main===module)migrate(process.argv.includes('--apply')).catch(()=>{process.exitCode=1;}).finally(()=>db.end());
module.exports={migrate};
