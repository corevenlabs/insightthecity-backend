const {test}=require('node:test'),assert=require('node:assert/strict');
const {imageType}=require('../services/image-file');
test('general uploads reject SVG, HTML and false MIME signatures while allowing supported image types',()=>{
 assert.equal(imageType(Buffer.from('<svg onload="alert(1)">')),null);
 assert.equal(imageType(Buffer.from('<html>not an image')),null);
 assert.equal(imageType(Buffer.from([255,216,255,0])).ext,'.jpg');
 assert.equal(imageType(Buffer.from([137,80,78,71,13,10,26,10])).mime,'image/png');
 assert.equal(imageType(Buffer.from('RIFF0000WEBPtest')).mime,'image/webp');
 assert.equal(imageType(Buffer.from('GIF89a00000')).mime,'image/gif');
});
test('stale sessions are denied while initial legacy sessions remain usable until a password change',async()=>{
 const db=require('../config/db'),jwt=require('jsonwebtoken'),{requireUserAuth}=require('../middleware/auth');const original=db.query,secret=process.env.JWT_SECRET;
 try{process.env.JWT_SECRET='isolated-session';for(const [sv,version,expected]of [[undefined,0,true],[undefined,1,false],[0,1,false],[1,1,true]]){
 db.query=async()=>({rows:[{is_active:true,session_version:version}]});let allowed=false,status;
 await requireUserAuth({headers:{authorization:'Bearer '+jwt.sign({id:1,type:'user',...(sv==null?{}:{sv})},process.env.JWT_SECRET)}},{status(n){status=n;return this;},json(){}},()=>{allowed=true;});
 assert.equal(allowed,expected);if(!expected)assert.equal(status,401);
 }}finally{db.query=original;if(secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=secret;}
});
