// Shared reading family for every HTML email, including plain-text-only notices.
// Email clients that block custom fonts consistently fall back to Arial.
const EMAIL_STACK = 'Roboto,Arial,Helvetica,sans-serif';
const BASE='https://itc-backend-1031252664334.us-east1.run.app';
function base(){return (process.env.PUBLIC_BASE_URL||BASE).replace(/\/$/,'');}
function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function style(){
 const faces=[[400,'Roboto_400Regular'],[500,'Roboto_500Medium'],[600,'Roboto_600SemiBold'],[700,'Roboto_700Bold'],[800,'Roboto_800ExtraBold'],[900,'Roboto_900Black']].map(([weight,file])=>`@font-face{font-family:Roboto;font-style:normal;font-weight:${weight};src:url('${base()}/brand-assets/fonts/${file}.ttf')}`).join('');
 return `<style data-itc-typography="v1">${faces}body,table,td,p,a,div,span,h1,h2,h3,h4,input,button{font-family:${EMAIL_STACK}!important}h1,h2,h3,h4{font-weight:800}</style>`;
}
function email(message){
 let html=message.html;
 if(!html&&message.text){html=`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#080808;color:#fff;padding:24px;font-family:${EMAIL_STACK}"><div style="max-width:600px;margin:auto;background:#0a0a0a;padding:28px;border:1px solid #333"><img src="${base()}/email-assets/itc-club-logo-v1.png" width="150" alt="ITC Club" style="display:block;margin:0 auto 28px;max-width:100%"><div style="font-size:16px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere">${escape(message.text)}</div></div></body></html>`;}
 if(typeof html!=='string'||html.includes('data-itc-typography='))return html?{...message,html}:message;
 html=html.replace(/font-family\s*:\s*[^;"<>}]+/gi,`font-family:${EMAIL_STACK}`);
 if(/<\/head>/i.test(html))html=html.replace(/<\/head>/i,style()+'</head>');else if(/<html[^>]*>/i.test(html))html=html.replace(/<html[^>]*>/i,match=>match+'<head>'+style()+'</head>');else html=style()+html;
 return {...message,html};
}
module.exports={email,EMAIL_STACK};
