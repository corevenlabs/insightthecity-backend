const jwt=require('jsonwebtoken');
const db=require('../config/db');
const PUBLIC_LABEL='Beneficio exclusivo para miembros ITC Club';
const PUBLIC_REPLACEMENT='código exclusivo para miembros ITC Club';
const legacy=value=>typeof value==='string'?/^\s*(?:COD|CÓDIGO|CODIGO|CODE)\s*:\s*([A-Za-z0-9_-]{3,80})\s*$/i.exec(value)?.[1]:undefined;
function codeFor(row){
 if(!row || row.access!=='premium' || row.benefit_action!=='external')return null;
 return (typeof row.private_benefit_code==='string'&&row.private_benefit_code.trim())||legacy(row.member_benefit)||detailedCode(row.member_benefit_details)||null;
}
const detailedCode=value=>typeof value==='string'?/(?:código|codigo|code)\s+\*\*([A-Za-z0-9_-]{3,80})\*\*/i.exec(value)?.[1]:undefined;
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function redact(value,code){
 if(typeof value==='string')return value.replace(new RegExp(escape(code),'gi'),PUBLIC_REPLACEMENT);
 if(Array.isArray(value))return value.map(item=>redact(item,code));
 return value;
}
const camelFields=['title','description','recommendation','memberBenefit','memberBenefitDetails','cardBenefit','benefitInstructions','date','originalDate','includes','cardDescription','benefitCta','ticketCta'];
function publicRecord(row,record,staff=false){
 const code=codeFor(row);if(!code)return record;
 const result={...record,privateBenefitRequired:true};
 for(const key of camelFields)if(result[key]!=null)result[key]=redact(result[key],code);
 if(legacy(row.member_benefit))result.memberBenefit=PUBLIC_LABEL;
 delete result.privateBenefitCode;
 if(staff)return {...result,privateBenefitCode:code};
 return {...result,benefitUrl:null,ticketUrl:null};
}
function catalogRow(row){
 const code=codeFor(row);if(!code)return row;
 const result={...row};delete result.private_benefit_code;
 for(const key of ['title','description','recommendation','member_benefit','member_benefit_details','card_benefit','benefit_instructions','date_label','includes','benefit_cta','ticket_cta'])if(result[key]!=null)result[key]=redact(result[key],code);
 if(legacy(row.member_benefit))result.member_benefit=PUBLIC_LABEL;
 result.benefit_url=null;result.ticket_url=null;return result;
}
async function member(id,sv){
 if(!Number.isSafeInteger(id)||id<1)return null;
 const user=(await db.query("SELECT id,is_active,is_premium,session_version FROM users WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM account_deletions WHERE user_id=$1 AND status='pending')",[id])).rows[0];
 return user?.is_active&&user.is_premium&&Number(user.session_version||0)===Number(sv??0)?user:null;
}
async function optionalMember(req,res,next){
 req.benefitMember=null;
 const auth=req.headers.authorization||'';if(!auth.startsWith('Bearer '))return next();
 let claims;
 try{claims=jwt.verify(auth.slice(7),process.env.JWT_SECRET,{algorithms:['HS256']});}catch{return next();}
 if(claims.type!=='user')return next();
 try{req.benefitMember=await member(claims.id,claims.sv);return next();}catch{return next(Object.assign(new Error('No se pudo verificar la membresía'),{status:503}));}
}
function grant(row,user,target){
 return jwt.sign({type:'private_benefit_link',experience:row.id,uid:user.id,sv:Number(user.session_version||0),target},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'5m'});
}
function memberRecord(row,record,user,lang){
 const code=codeFor(row);if(!code || !user || !row.is_published)return record;
 const links=require('./external-benefit-link');
 const link=target=>{const u=new URL(links.url(row.id,lang,target));u.searchParams.set('grant',grant(row,user,target));return u.href;};
 return {...record,privateBenefitRequired:true,privateBenefitCode:code,benefitUrl:row.benefit_url?link('benefit'):null,ticketUrl:row.is_paid_event&&row.ticket_url?link('tickets'):null};
}
async function authorizeLink(token,row,target){
 let claims;
 try{claims=jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256']});}catch{return false;}
 if(claims.type!=='private_benefit_link'||claims.experience!==row.id||claims.target!==target)return false;
 return Boolean(await member(claims.uid,claims.sv));
}
function validation(body){
 const value=body.privateBenefitCode;
 if(value!==undefined&&value!==null&&(typeof value!=='string'||value.trim().length>120))return 'El código privado debe ser texto de hasta 120 caracteres.';
 const code=typeof value==='string'?value.trim():null;
 if(code&&((body.benefitAction!==undefined&&body.benefitAction!=='external')||(body.access!==undefined&&body.access!=='premium')))return 'El código privado solo se usa en beneficios Premium con enlace externo.';
 if(body.benefitAction==='external'&&legacy(body.memberBenefit))return 'Escribe el código en «Código de descuento (solo premium)» y deja una descripción pública del beneficio.';
 if(code&&camelFields.some(key=>JSON.stringify(body[key]??'').toLowerCase().includes(code.toLowerCase())))return 'El código debe ir únicamente en «Código de descuento (solo premium)», no en los textos públicos.';
 return null;
}
async function save(c,id,data){
 if(data.private_benefit_code===undefined)return;
 const row=(await c.query('SELECT access,benefit_action FROM experiences WHERE id=$1',[id])).rows[0];
 if(data.private_benefit_code && (row?.access!=='premium'||row?.benefit_action!=='external'))throw Object.assign(new Error('El código privado requiere un beneficio Premium con enlace externo'),{status:400});
 await c.query('UPDATE experiences SET private_benefit_code=$2 WHERE id=$1',[id,data.private_benefit_code||null]);
}
module.exports={codeFor,publicRecord,catalogRow,optionalMember,memberRecord,authorizeLink,validation,save,legacy};
