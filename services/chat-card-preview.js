// Extract only published wording. No generated claims, invented photos or conditions.
function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#(?:0*39|x0*27);/gi,"'").replace(/&#(\d+);/g,(_,code)=>{const n=Number(code);return n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/\s+/g,' ').trim();
}
function previewFor(item) {
  let text=plainText(item.description);
  if(!text)return '';
  text=text.replace(/^(?:ubicad[oa]|situad[oa]|located|si buscas)[^,]{0,120},\s*/i,'');
  const title=plainText(item.title).split(':')[0].trim();
  if(title && text.toLocaleLowerCase().startsWith(title.toLocaleLowerCase()+' '))text=text.slice(title.length).trim();
  const sentence=text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || text;
  const words=sentence.split(/\s+/);let result='';
  for(const word of words){if(Array.from((result?result+' ':'')+word).length>145)break;result+=(result?' ':'')+word;}
  if(!result)return '';
  if(result!==sentence)result=result.replace(/[,;:]$/,'')+'…';
  return result.charAt(0).toLocaleUpperCase()+result.slice(1);
}
function imageFor(value) {
  try{const url=new URL(String(value||''));return url.protocol==='https:'?url.href:null;}catch{return null;}
}
module.exports={previewFor,imageFor};
