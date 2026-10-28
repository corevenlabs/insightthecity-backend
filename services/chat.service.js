const contentLanguage = require('./content-language.service');
const db = require('../config/db');
const experiencesService = require('./experiences.service');
const newsService = require('./news.service');
const rules = require('./chat-catalog-rules');
const {previewFor,imageFor}=require('./chat-card-preview');
const firstName = name => String(name || '').trim().split(/\s+/)[0] || '';
function greetingFor(user) {
  const name=firstName(user?.name);
  if(user?.language==='en')return name?`Hi, ${name}! How are you?`:'Hi! How are you? What should I call you?';
  if(user?.language==='pt')return name?`Olá, ${name}! Como você está?`:'Olá! Como você está? Como posso te chamar?';
  return name?`¡Hola, ${name}! ¿Cómo estás?`:'¡Hola! ¿Cómo estás? ¿Cómo te gustaría que te llame?';
}
function welcomeFor(user) {
  const name=firstName(user?.name);
  if(user?.language==='en')return `Hi${name?`, ${name}`:''}! 👋 What would you like to do today?`;
  if(user?.language==='pt')return `Olá${name?`, ${name}`:''}! 👋 O que você quer fazer hoje?`;
  return `¡Hola${name?`, ${name}`:''}! 👋 ¿Qué te provoca hacer hoy?`;
}
const words={
 es:{intro:'¡Claro! Mira estas opciones.',news:'Mira estas novedades de NY al día.',plans:'Encontré estos planes para ti.',none:'No encontré opciones con esos filtros. ¿Probamos otra zona?',unavailable:'No pude verificar el catálogo. ¿Intentamos de nuevo?',clarify:'¿Te provoca comer, visitar museos o descubrir otra experiencia?',identity:'Soy YORKi, tu guía de ITC Club. ¿Qué hacemos hoy?',thanks:'¡Con gusto! 😊',date:'Revisa fechas y disponibilidad en el detalle.',join:'Conoce la membresía ITC Club para acceder a los beneficios indicados.',active:'Tu membresía te permite acceder a los beneficios indicados; revisa las condiciones.',price:'No tengo precios verificados en la app. Revisa el detalle.',hours:'No tengo horarios en tiempo real. Revisa el detalle.',scope:'Busco solo dentro de la app. ¿Qué plan te provoca?',member:'Con ITC Club accedes a los beneficios publicados. Puedes conocer la membresía aquí.'},
 en:{intro:'Of course! Take a look at these options.',news:'Here are some updates from NY al día.',plans:'I found these plans for you.',none:'No matches with those filters. Shall we try another area?',unavailable:'I could not check the catalog. Shall we try again?',clarify:'Would you like food, museums, or another experience?',identity:'I’m YORKi, your ITC Club guide. I help you find plans and benefits published in the app.',thanks:'You’re welcome! I’m here to help you find your next plan.',date:'Check dates and availability in the details.',join:'Explore ITC Club membership to access the listed member benefits.',active:'Your membership gives you access to the listed benefits; check their conditions.',price:'The app has no verified prices for that budget. Check the details.',hours:'I do not have live opening hours. Check the details.',scope:'I can only recommend content published in this app. What kind of plan are you looking for?',member:'ITC Club membership gives you access to the benefits listed in Club publications. You can review the conditions before joining.'},
 pt:{intro:'Claro! Veja estas opções.',news:'Veja estas novidades de NY al día.',plans:'Encontrei estes passeios para você.',none:'Não encontrei opções com esses filtros. Vamos tentar outra região?',unavailable:'Não consegui verificar o catálogo. Vamos tentar de novo?',clarify:'Você prefere comida, museus ou outra experiência?',identity:'Sou YORKi, seu guia do ITC Club. Ajudo você a encontrar passeios e benefícios publicados no app.',thanks:'De nada! Estou aqui para ajudar com seu próximo passeio.',date:'Confira datas e disponibilidade nos detalhes.',join:'Conheça a assinatura ITC Club para acessar os benefícios indicados.',active:'Sua assinatura permite acessar os benefícios indicados; confira as condições.',price:'Não tenho preços verificados para esse orçamento. Confira os detalhes.',hours:'Não tenho horários em tempo real. Confira os detalhes.',scope:'Só posso recomendar publicações deste app. Que tipo de passeio você procura?',member:'A assinatura ITC Club dá acesso aos benefícios indicados nas publicações do Club. Confira as condições antes de assinar.'},
};
function experienceItem(row, now) {
  const rawBenefit=String(row.card_benefit||row.member_benefit||'').trim();
  const memberBenefit=rawBenefit.length<=160?rawBenefit:'';
  const expiry=row.coupon_ends_at&&new Date(row.coupon_ends_at)<now;
  const disabled=row.benefit_action==='qr'&&(row.coupon_active===false||(row.coupon_inventory_mode==='limited'&&Number(row.coupon_total)-Number(row.coupon_redeemed||0)-Number(row.coupon_reserved||0)<=0));
  return {kind:'experience',id:row.id,title:row.title,category:row.category,tags:row.tags||[],description:row.description||'',location:row.location||'',locations:row.locations||[],region:row.region,access:row.access,section:row.section,memberBenefit,memberBenefitDetails:'',hasConditions:!!(row.member_benefit_details||row.benefit_instructions),hasBenefit:row.access==='premium'&&!!rawBenefit&&!expiry&&!disabled,date:row.date_label,endsAt:row.ends_at,isPaidEvent:!!row.is_paid_event,image:imageFor(row.image_url||row.image),source:row.access==='premium'?'club':'app'};
}
// Same two editorial feeds exposed by /api/news, not an internet search tool.
const editorialCache=new Map();
async function editorialItems(section) {
  const hit=editorialCache.get(section);
  if(hit&&Date.now()-hit.at<5*60000)return hit.promise;
  const promise=(async()=>{
    const first=await newsService.listNews({section,page:1,perPage:100,catalog:true});
    const pages=Math.max(1,Number(first.totalPages)||1);
    if(pages>100)throw new Error('Editorial catalog needs pagination');
    const rows=[...(first.items||[])];
    for(let page=2;page<=pages;page+=4){
      const batch=await Promise.all(Array.from({length:Math.min(4,pages-page+1)},(_,i)=>newsService.listNews({section,page:page+i,perPage:100,catalog:true})));
      batch.forEach(result=>rows.push(...result.items));
    }
    return rows.map(row=>({kind:'news',id:row.id,title:row.title,description:row.excerpt||'',section,publishedAt:row.date,image:row.image,hasBenefit:false,source:section}));
  })();
  editorialCache.set(section,{at:Date.now(),promise});
  try{return await promise;}catch(error){editorialCache.delete(section);throw error;}
}
function relevantItems(items,query){const {filters}=rules.filtersFor([{role:'user',message:query}],items);return rules.matching(items.map(x=>({...x,kind:x.kind||'experience'})),filters);}

async function getHistory(userId, limit = 30) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 50);
  const { rows } = await db.query(
    `SELECT id, role, message, created_at, catalog_context FROM (
       SELECT id, role, message, created_at, catalog_context FROM chat_messages
       WHERE user_id = $1 AND created_at >= NOW()-INTERVAL '90 days' ORDER BY created_at DESC, id DESC LIMIT $2
     ) history ORDER BY created_at ASC, id ASC`,
    [userId, safeLimit]
  );
  return rows;
}

async function saveMessage(userId, role, message, context = null) {
  const { rows } = await db.query(
    `INSERT INTO chat_messages (user_id, role, message, catalog_context) VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, role, message, created_at`,
    [userId, role, message, context ? JSON.stringify(context) : null]
  );
  return rows[0];
}

function withoutLinks(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, '')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|app|nyc|co)(?:\/[^\s<>]*)?\b/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function respond({ user={}, history=[], now=new Date() }) {
  const text=rules.normalize(history.at(-1)?.message).trim();
  const copy=words[user.language]||words.es;
  const empty=reply=>({reply,appItems:[],places:[],showMembership:false});
  if(/^[¡!¿?.\s]*(hola|buenas|buenos dias|buenas tardes|buenas noches|hello|hi|hey|ola|oi)[!¡?.\s]*$/.test(text))return empty(greetingFor(user));
  if(/^(gracias|muchas gracias|thanks|thank you|obrigad[oa])[!¡.\s]*$/.test(text))return empty(copy.thanks);
  if(/\b(quien eres|que eres|who are you|quem e voce)\b/.test(text))return empty(copy.identity);
  if(/\b(internet|google|busca fuera|buscar fuera|search the web|search online|ignore.*instructions|ignora.*instrucciones)\b/.test(text))return empty(copy.scope);
  if(/\b(membresia|membership|assinatura)\b/.test(text)&&!rules.GENERIC.test(text)&&!/\b(comida|museo|atraccion|restaurante|food|museum|plan|beneficios)\b/.test(text))return {...empty(user.is_premium?copy.active:copy.member),showMembership:!user.is_premium};
  let club;
  try {club=(await experiencesService.list({publishedOnly:true})).rows.filter(row=>row.is_published!==false).map(row=>experienceItem(row,now)).sort((a,b)=>Number(b.hasBenefit)-Number(a.hasBenefit));}
  catch{return empty(copy.unavailable);}
  const context=rules.filtersFor(history,club), f=context.filters;
  if(f.dietary)return {...empty(user.language==='en'?'The app does not verify dietary certifications or allergens. Please confirm those requirements directly with the business.':user.language==='pt'?'O app não verifica certificações alimentares ou alérgenos. Confirme esses requisitos diretamente com o estabelecimento.':'La app no verifica certificaciones alimentarias ni alérgenos. Confirma esos requisitos directamente con el negocio.'),context:{version:1,filters:f,shown:[],excluded:context.excluded}};
  if(/\b(cerca de mi|cerca|near me|nearby|perto de mim)\b/.test(text)&&!f.area)return empty(user.language==='en'?'Which area would you like? I can filter the places published in the app.':user.language==='pt'?'Em qual região você está procurando? Posso filtrar os lugares publicados no app.':'¿En qué zona buscas? Puedo filtrar los lugares publicados en la app.');
  const meaningful=f.topics.length||f.excludedTopics.length||f.names.length||f.keywords.length||f.region||f.area||f.free||f.source||rules.GENERIC.test(text)||rules.REJECT.test(text);
  if(!meaningful)return empty(copy.clarify);
  if(f.needsPrice)return {...empty(copy.price),context:{version:1,filters:f,shown:[],excluded:context.excluded}};
  if(f.needsHours)return {...empty(copy.hours),context:{version:1,filters:f,shown:[],excluded:context.excluded}};
  let found=f.source?[]:rules.matching(club,f,context.excluded,now);
  let source='club';
  // Resolve each requested category independently, preserving source priority.
  const missing=()=>f.topics.length?f.topics.filter(topic=>!found.some(item=>rules.classify(item).includes(topic))):found.length?[]:[null];
  let pending=missing();
  try {
    const sources=f.source?[f.source]:['ny-al-dia','que-hacer'];
    for(const section of sources){
      if(!pending.length)break;
      if(f.benefits||f.names.length)break; // Editorial text cannot establish a Club benefit or replace a named business.
      const feed=await editorialItems(section);
      const subset={...f,topics:pending.filter(Boolean)};
      const matches=rules.matching(feed,subset,context.excluded,now);
      if(matches.length){if(!found.length)source=section;found.push(...matches);}
      pending=missing();
    }
  } catch {return empty(copy.unavailable);}
  found=[...new Map(found.map(item=>[`${item.kind}:${item.id}`,item])).values()];
  const showMembership=!user.is_premium&&found.some(item=>item.hasBenefit);
  const saved={version:1,filters:f,shown:found.slice(0,3).map(item=>`${item.kind}:${item.id}`),excluded:context.excluded};
  if(!found.length)return {...empty(copy.none),context:saved,filters:f};
  const intro=copy[source==='ny-al-dia'?'news':source==='que-hacer'?'guides':'intro'];
  // Only catalog strings supply names and offers; the model cannot invent facts.
  const reply=[intro,f.when?copy.date:''].filter(Boolean).join(' ');
  return {reply,appItems:await Promise.all(found.map(async item=>{const localized=await contentLanguage.chatItem(item,user.language);return {...localized,preview:previewFor(localized),image:imageFor(item.image)};})),places:[],showMembership,source,filters:f,context:saved};
}
module.exports={getHistory,saveMessage,respond,greetingFor,welcomeFor,relevantItems,withoutLinks,experienceItem,clearCatalogCache:()=>editorialCache.clear()};
