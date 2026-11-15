// PostgreSQL text/JSONB cannot persist U+0000. Pasted PDF/web content may contain it.
// Remove only that invisible code point in editorial text; retain all valid Unicode.
const textFields = new Set([
  'title','category','date','date_label','location','shortAddress','short_address',
  'description','recommendation','cardBenefit','card_benefit','memberBenefit','member_benefit',
  'memberBenefitDetails','member_benefit_details','benefitCta','benefit_cta',
  'benefitInstructions','benefit_instructions','ticketCta','ticket_cta',
]);
const labels = {
  id:'identificador',client_id:'cliente vinculado',region:'región',section:'sección',
  image:'imagen de portada',image_url:'imagen de portada',images:'imágenes',
  mapsUrl:'enlace de Google Maps',maps_url:'enlace de Google Maps',
  benefitUrl:'enlace del beneficio',benefit_url:'enlace del beneficio',
  ticketUrl:'enlace de entradas',ticket_url:'enlace de entradas',
  instagramUrl:'enlace de Instagram',tiktokUrl:'enlace de TikTok',facebookUrl:'enlace de Facebook',
  instagram_url:'enlace de Instagram',tiktok_url:'enlace de TikTok',facebook_url:'enlace de Facebook',
  endsAt:'fecha de finalización',ends_at:'fecha de finalización',
  couponStartsAt:'fecha de inicio del beneficio',couponEndsAt:'fecha de fin del beneficio',
};
function editorial(path) {
  return path.length===1 && textFields.has(path[0]) ||
    path.length===2 && ['tags','includes'].includes(path[0]) ||
    path.length===3 && path[0]==='locations' && ['name','address'].includes(path[2]);
}
function normalizeExperienceText(body) {
  function visit(value,path=[]) {
    if(typeof value==='string') {
      if(!value.includes('\u0000'))return value;
      if(editorial(path))return value.replaceAll('\u0000','');
      const field=labels[path[0]]||'contenido del formulario';
      throw Object.assign(new Error(`El campo «${field}» contiene un carácter invisible no válido. Borra ese valor y vuelve a introducirlo.`),{status:400});
    }
    if(Array.isArray(value))return value.map((item,i)=>visit(item,[...path,String(i)]));
    if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,visit(item,[...path,key])]));
    return value;
  }
  return visit(body);
}
module.exports = {normalizeExperienceText};
