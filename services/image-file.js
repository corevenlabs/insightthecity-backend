function imageType(bytes){
 if(!Buffer.isBuffer(bytes))return null;
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',ext:'.png'};
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {mime:'image/jpeg',ext:'.jpg'};
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',ext:'.webp'};
 if(bytes.length>=6&&['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)))return {mime:'image/gif',ext:'.gif'};
 if(bytes.length>=16&&bytes.toString('ascii',4,8)==='ftyp'&&['avif','avis'].includes(bytes.toString('ascii',8,12)))return {mime:'image/avif',ext:'.avif'};
 return null;
}
module.exports={imageType};
