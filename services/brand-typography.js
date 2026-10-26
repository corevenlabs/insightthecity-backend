// Helvetica Neue Condensed Black is the brand face for all system email text.
// Prefer the exact installed face; custom-font blocking falls back to a condensed family.
const bannerFiles = require('../config/email-helvetica-banners.json');
const EMAIL_STACK = 'HelveticaNeue-CondensedBlack,Helvetica Neue Condensed Black,ITCHelvetica,ITCBanner,Roboto Condensed,Arial Narrow,Arial,sans-serif';
const HEADING_STACK = EMAIL_STACK;
const BASE='https://itc-backend-1031252664334.us-east1.run.app';
function base(){return (process.env.PUBLIC_BASE_URL||BASE).replace(/\/$/,'');}
function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function style(){
 return `<style data-itc-typography="v3">@font-face{font-family:ITCHelvetica;src:local('HelveticaNeue-CondensedBlack'),local('Helvetica Neue Condensed Black');font-weight:900;font-style:normal}@font-face{font-family:ITCBanner;src:url('${escape(base())}/brand-assets/fonts/RobotoCondensed_900Black.ttf') format('truetype');font-weight:900;font-style:normal}body,table,td,p,a,div,span,h1,h2,h3,h4,h5,h6,input,button,strong,b,em,i,ul,ol,li,blockquote{font-weight:900!important;font-family:${EMAIL_STACK}!important}h1,h2,h3,h4,h5,h6{font-family:${HEADING_STACK}!important;font-weight:900!important}</style>`;
}
// Inline the family too: email clients can discard head styles and table cells
// do not reliably inherit the body's font. Preserve each element's other styles.
function inlineFamily(html, resize = true){
 return html.replace(/<(body|table|thead|tbody|tfoot|tr|td|th|p|a|div|span|h[1-6]|input|button|strong|b|em|i|ul|ol|li|blockquote|pre|code)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi,(tag,name,attrs)=>{
  const family=`font-family:${EMAIL_STACK}!important;font-weight:900!important`;
  const attr=/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i;
  if(attr.test(attrs))attrs=attrs.replace(attr,(_,quote,css)=>{
   css=css.replace(/font-weight\s*:[^;]+;?/gi,'').replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi,(_,size)=>`font-size:${!resize ? Number(size) : /^h[1-6]$/i.test(name) ? Math.min(34,Math.max(24,Number(size))) : Number(size)<=13 ? 14 : Number(size)<=16 ? 18 : Number(size)}px`).replace(/font-family\s*:\s*(?:"[^"]*"|'[^']*'|[^;"'])*/gi,'').replace(/^;+|;+$/g,'');
   return `style=${quote}${css ? css+';' : ''}${family}${quote}`;
  });else attrs+=` style="${family}"`;
  if(/^h[1-6]$/i.test(name))attrs=attrs.replace(attr,(_,quote,css)=>`style=${quote}${css.replace(/font-weight\s*:[^;]+;?/gi,'').replace(/;+/g,';').replace(/^;|;$/g,'')};font-weight:900!important${quote}`);
  return `<${name}${attrs}>`;
 });
}
function email(message){
 let html=message.html;
 if(!html&&message.text){html=`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#080808;color:#fff;padding:24px;font-family:${EMAIL_STACK}"><div style="max-width:600px;margin:auto;background:#0a0a0a;padding:28px;border:1px solid #333"><img src="${base()}/email-assets/itc-club-logo-v1.png" width="150" alt="ITC Club" style="display:block;margin:0 auto 28px;max-width:100%"><div style="font-size:16px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere">${escape(message.text)}</div></div></body></html>`;}
 if(typeof html!=='string')return message;
 const resize = !/data-itc-typography=["']v3["']/.test(html);
 html=html.replace(/<style\b[^>]*data-itc-typography=["']v[123]["'][^>]*>[\s\S]*?<\/style>/gi,'');
 html=html.replace(/(\/email-assets\/)([A-Za-z0-9_-]+\.png)/g,(_,prefix,name)=>prefix+(bannerFiles[name]||name));
 html=inlineFamily(html, resize);
 if(/<\/head>/i.test(html))html=html.replace(/<\/head>/i,style()+'</head>');else if(/<html[^>]*>/i.test(html))html=html.replace(/<html[^>]*>/i,match=>match+'<head>'+style()+'</head>');else html=style()+html;
 return {...message,html};
}
module.exports={email,EMAIL_STACK};
