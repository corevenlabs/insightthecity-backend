// YORKi's search rails. No model output can select a business or change a filter.
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '');
const TOPICS = {
  food: /\b(comida|comer|restaurantes?|restaurant|restaurants|food|eat|eating|dining|gastronomia|gastronomy|cafeterias?|cafes?|cafe|almorzar|almuerzo|cenar|cena|desayuno|lunch|dinner|breakfast|pizza|sushi|empanadas?|arepas?|hamburguesas?|vegetarian[oa]?|vegan[oa]?)\b/,
  museums: /\b(museos?|muses|museums?|museus?)\b/,
  attractions: /\b(atraccion(?:es)?|atracao|atracoes|attractions?|inmersiv[ao]s?|immersive|miradores?|observatorios?|simulador(?:es)?|4d)\b/,
  tours: /\b(tours?|recorridos?|hop.on.hop.off|autobus|bus turistico|sightseeing)\b/,
  beauty: /\b(belleza|beauty|spa|spas|facial(?:es)?|maquillaje|estetica|beleza)\b/,
  outdoors: /\b(aire libre|outdoors?|parques?|parks?|naturaleza|nature|atardecer|sunset|ar livre)\b/,
  nightlife: /\b(nightlife|bares?|bar|vida nocturna|nocturno|fiesta|balada)\b/,
  events: /\b(eventos?|events?|conciertos?|concerts?|festival(?:es)?|festivals?|teatros?|theater|shows?|broadway)\b/,
  shopping: /\b(compras|shopping|tiendas?|mercados?|markets?)\b/,
};
const AREAS = {
  Manhattan:['manhattan','west village','east village','greenwich village','midtown','times square','central park','columbus circle','soho','harlem','chelsea','tribeca','lower east side','upper east side','upper west side','bryant park','washington heights'],
  Brooklyn:['brooklyn','williamsburg','bushwick','dumbo'], Queens:['queens','elmhurst','astoria','flushing','jackson heights','long island city'],
  Bronx:['bronx'], 'Staten Island':['staten island'], Hoboken:['hoboken'], 'Jersey City':['jersey city'], Newark:['newark'],
};
const LOCAL_AREAS = ['west village','east village','greenwich village','midtown','times square','central park','columbus circle','soho','harlem','chelsea','tribeca','lower east side','upper east side','upper west side','bryant park','washington heights','williamsburg','bushwick','dumbo','elmhurst','astoria','flushing','jackson heights','long island city'];
const GENERIC = /\b(que (?:puedo |hay |podemos |podria )?hacer|what (?:can|could|to).*do|o que fazer|planes|plan|opciones|options|recomienda|recomiendas|recommend|sugiere|suggest|salir|visitar|visit|busca|buscar|busco|find|looking for)\b/;
const REJECT = /\b(ningun[ao]s?|ninguna de esas|no me (?:gustan|interesan)|no esas|nada de eso|otras? opciones|otras? alternativas|algo mas|ver mas|muestra mas|mas resultados|more options|show more|anything else|none of|other options|mais opcoes)\b/;
const RESET = /\b(empezar de nuevo|otra conversacion|nueva busqueda|start over|new search|reset)\b/;
const STOP = new Set(('hola quiero quieres quisiera gustaria busco busca buscar recomiendas recomienda recomendar recomienda algo algun alguna algunos algunas que q puedo podemos podria hacer hoy manana ahora mejor opinion cambie cambiado favor porfavor por fa para con sin en de del el la los las un una unos unas me mi mis y o si no ni quiero todos todas todo relacionada relacionados relacionado relacionadas tiene tienen tenga tienen ver voy vamos salir lugar lugares opciones opcion plan planes informacion info dime dame muestra mostrar encuentra encontrar dentro app club itc yorki por favor donde cuando como mas otra otro otras otros eso esas esos hay sea sean ser estoy estamos nosotros nosotros tu usted sobre aqui cerca buenas gracias please want looking find recommend recommendations something anything things what can could do today tomorrow now better would like with without near in at of for and or is are a an the to from new york nueva nueva york ny nyc nj new jersey nueva jersey eu quero comer comer food comida restaurant restaurante restaurantes gastronomia museos museo museum museums attraction attractions atracciones atraccion experiencia experiencias inmersiva inmersivas immersive tour tours recorrido recorridos belleza beauty spa evento eventos event events aire libre outdoors parque parques park parks gratis gratuito gratuita gratuitos free gratuito beneficios beneficio descuento descuentos discount discounts membership membresia miembro miembros con club tienes tienen tiene disponible disponibles solo solamente any alguna nada relacionada relacionado').split(/\s+/));
const tokens = value => normalize(value).split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t));
const phrase = (text, word) => (` ${text.replace(/[^a-z0-9 ]/g,' ')} `).includes(` ${word} `);
function mentionedTopics(message) {
  const text = normalize(message), yes=[], no=[];
  for (const [topic, regex] of Object.entries(TOPICS)) {
    const match = text.match(regex); if (!match) continue;
    const before = text.slice(Math.max(0,match.index-55),match.index).split(/[,;]|\b(?:pero|mejor|instead|sino)\b/).at(-1);
    const after=text.slice(match.index+match[0].length,match.index+match[0].length+12);
    const negative = /^\s*(?:no|not|nao)\b/.test(after) || /(?:\bno\b.{0,40}|\bsin\b.{0,30}|nothing to do with.{0,20}|not.{0,15}|sem.{0,15})$/.test(before);
    (negative ? no : yes).push(topic);
  }
  return {yes,no};
}
function classify(item) {
  // Experience types come from the author's structured fields, never their legacy ID.
  const structured = normalize([item.category,...(item.tags||[])].join(' '));
  const text = item.kind === 'news' ? normalize(item.title+' '+item.description) : structured;
  const topics = Object.entries(TOPICS).filter(([,r])=>r.test(text)).map(([k])=>k);
  if (!topics.includes('outdoors') && !topics.includes('food') && /\b(al aire libre|outdoors|parque|park|atardecer|sunset)\b/.test(normalize(item.title+' '+item.description))) topics.push('outdoors');
  return topics;
}
function namedItems(message, items) {
  const text=normalize(message);
  return items.filter(item=>{
    const base=normalize(item.title.split(':')[0]).replace(/[^a-z0-9 ]/g,' ').trim();
    const alias=base.split(/\s+/).slice(0,2).join(' ');
    return base.length>=4 && (phrase(text,base) || (alias.length>=5 && phrase(text,alias)));
  });
}
function filtersFor(history, items) {
  let state={topics:[],excludedTopics:[],region:null,area:null,keywords:[],names:[],benefits:false,free:false,when:null,source:null,needsPrice:false,needsHours:false,dietary:false};
  const latest=history.at(-1)||{};
  const saved=[...history].reverse().find(row=>row.role==='assistant' && row.catalog_context?.version===1);
  const fresh=saved && (!saved.created_at || !latest.created_at || new Date(latest.created_at)-new Date(saved.created_at)<2*3600000);
  let messages=history.filter(row=>row.role==='user');
  if(fresh) { state={...state,...saved.catalog_context.filters}; messages=[latest]; }
  else if(latest.created_at) messages=messages.filter(row=>!row.created_at||new Date(latest.created_at)-new Date(row.created_at)<2*3600000);
  for (const row of messages) {
    const text=normalize(row.message);
    const {yes,no}=mentionedTopics(text);
    if(RESET.test(text)) state={topics:[],excludedTopics:[],region:null,area:null,keywords:[],names:[],benefits:false,free:false,when:null,source:null,needsPrice:false,needsHours:false,dietary:false};
    const named=namedItems(text,items);
    const changedTopics=yes.length>0&&(yes.some(t=>!state.topics.includes(t))||state.topics.some(t=>!yes.includes(t)));
    const newTopic=changedTopics || named.length>0 || /\b(cambie|ahora quiero|cambiar|changed my mind|instead|mudei)\b/.test(text);
    if(newTopic){state.topics=yes;state.names=[];state.keywords=[];state.source=null;state.needsPrice=false;state.needsHours=false;state.dietary=false;}
    if(yes.length)state.excludedTopics=state.excludedTopics.filter(t=>!yes.includes(t));
    if(no.length){state.excludedTopics=[...new Set([...state.excludedTopics,...no])];state.topics=state.topics.filter(t=>!no.includes(t));state.names=[];state.keywords=[];}
    if(named.length){state.names=named.map(i=>`${i.kind}:${i.id}`);state.excludedTopics=state.excludedTopics.filter(t=>!named.some(i=>classify(i).includes(t)));}
    if(/\b(noticias|news|novedades|ny al dia|nueva york al dia|noticias de)\b/.test(text))state.source='ny-al-dia';
    if(/\b(seccion|articulos|publicaciones|guias|section|articles)\b.*\b(que hacer|what to do)\b/.test(text))state.source='que-hacer';
    if(/\b(club|membresia|membership)\b/.test(text)&& !/\b(noticias|news|seccion)\b/.test(text))state.source=null;
    const nj=/\b(nj|new jersey|nueva jersey|nova jersey)\b/.test(text),ny=/\b(ny|nyc|new york|nueva york|nova york)\b/.test(text);
    if(nj||ny){state.region=nj?'NJ':'NY';state.area=null;}
    const local=LOCAL_AREAS.find(a=>phrase(text,a));
    const area=Object.keys(AREAS).find(a=>phrase(text,normalize(a)));
    if(local||area){state.area=local||area;state.region=['Hoboken','Jersey City','Newark'].includes(area)?'NJ':'NY';}
    if(/\b(cualquier zona|toda la ciudad|anywhere|any area|sin importar la zona)\b/.test(text))state.area=null;
    if(/\b(beneficios?|descuentos?|discounts?|offers?|ofertas?)\b/.test(text))state.benefits=!/\b(sin|no necesito|without)\b.{0,20}\b(beneficios?|descuentos?|discounts?)\b/.test(text);
    if(/\b(gratis|gratuit[oa]s?|free|gratuitos?)\b/.test(text)){state.free=!/\b(no|not|sin)\b.{0,8}\b(gratis|free)\b/.test(text);if(state.free&&!/\b(beneficios?|descuentos?|discounts?)\b/.test(text))state.benefits=false;}
    if(/\b(no importa el precio|no tiene que ser gratis|puede ser de pago|paid is fine)\b/.test(text))state.free=false;
    if(/\b(hoy|today|hoje)\b/.test(text))state.when='today';
    if(/\b(manana|tomorrow|amanha)\b/.test(text))state.when='tomorrow';
    if(/\b(fin de semana|weekend|fim de semana)\b/.test(text))state.when='weekend';
    if(/\b(cualquier dia|sin fecha|any day)\b/.test(text))state.when=null;
    if(/\b(precio|precios|cuesta|cuestan|cost|costs|barat[oa]|cheaper|presupuesto|budget|maximo|maxima|menos de \d+|under \d+)\b/.test(text))state.needsPrice=true;
    if(/\b(abiert[oa]s? (?:ahora|hoy)|open now|horarios?|opening hours)\b/.test(text))state.needsHours=true;
    if(/\b(gluten|alergias?|allerg(?:y|ies)|intoleran(?:cia|ce)|halal|kosher)\b/.test(text))state.dietary=true;
    if(/\b(sin restricciones alimentarias|no tengo alergias|no dietary restrictions|cualquier comida)\b/.test(text))state.dietary=false;
    if(/\b(no importa el precio|sin presupuesto|any price|no budget)\b/.test(text))state.needsPrice=false;
    if(/\b(sin importar el horario|any opening hours)\b/.test(text))state.needsHours=false;
    const subtype=text.match(/\b(pizza|sushi|empanadas?|arepas?|festival(?:es)?|conciertos?|hamburguesa|hamburguesas|vegetarian[oa]|vegan[oa]|peruan[oa]|venezolan[oa]|argentin[oa]|mexican[oa]|italian[oa]|japones[a]?|chino|china)\b/g);
    if(subtype)state.keywords=subtype.map(t=>t.replace(/festivales/,'festival').replace(/s$/,''));
    if(!yes.length&&!no.length&&!named.length&&!area&&!local&&!REJECT.test(text)&&!RESET.test(text)&&! /\b(no importa el precio|sin presupuesto|any price|no budget|sin restricciones alimentarias|no tengo alergias|no dietary restrictions|sin importar el horario)\b/.test(text)){
      const residual=tokens(text).filter(t=>!['cambie','opinion','tenga','puedo','restaurante','museu','museum','hacer','saludo','noticias','news','novedades','dia','al','seccion','publicaciones','articulos','guias','hola','hoy','manana','fin','semana','weekend'].includes(t));
      if(residual.length && !GENERIC.test(text))state.keywords=residual;
    }
  }
  const text=normalize(latest.message);
  const reject=REJECT.test(text);
  if(reject&&!/\b(beneficios?|descuentos?|discounts?)\b/.test(text))state.benefits=false;
  let excluded=[];
  if(reject&&fresh){excluded=[...(saved.catalog_context.excluded||[]),...(saved.catalog_context.shown||[])];}
  if(reject&&!fresh){excluded=items.filter(item=>history.filter(x=>x.role==='assistant').some(x=>normalize(x.message).includes(normalize(item.title)))).map(i=>`${i.kind}:${i.id}`);}
  return {filters:state,excluded:[...new Set(excluded)],reject};
}
function itemRegion(item) {
  if(item.region)return item.region;
  const text=normalize(item.title+' '+item.description+' '+item.location);
  if(/\b(new jersey|nueva jersey|nj|hoboken|jersey city|newark)\b/.test(text))return 'NJ';
  if(/\b(nueva york|new york|nyc|manhattan|brooklyn|queens|bronx|staten island|ny)\b/.test(text))return 'NY';
  return null;
}
function areaMatches(item, area) {
  if(!area)return true;
  const text=normalize([item.title,item.location,item.description,...(item.locations||[]).map(x=>x.address)].join(' '));
  const aliases=AREAS[area]||[area];
  if(aliases.some(a=>phrase(text,a)))return true;
  // An address's registered ZIP is evidence; a legacy slug is not.
  const zip=String(item.location||'').match(/\b(\d{5})\b/)?.[1];
  return area==='Manhattan'&&zip&&Number(zip)>=10001&&Number(zip)<=10299;
}
function dateNY(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function matching(items, filters, excluded=[], now=new Date()) {
  return items.filter(item=>{
    const key=`${item.kind}:${item.id}`,types=classify(item);
    if(excluded.includes(key))return false;
    if(item.endsAt&&new Date(item.endsAt)<now)return false;
    if(filters.names.length&&!filters.names.includes(key))return false;
    if(filters.topics.length&&!filters.topics.some(t=>types.includes(t)))return false;
    if(filters.excludedTopics.some(t=>types.includes(t)))return false;
    if(filters.region&&itemRegion(item)!==filters.region)return false;
    if(!areaMatches(item,filters.area))return false;
    if(filters.benefits&&(item.kind!=='experience'||!item.hasBenefit))return false;
    // A complimentary member ticket is not a free public attraction.
    if(filters.free&&(item.kind==='experience'?(item.access!=='free'||item.isPaidEvent):! /\b(gratis|gratuit[oa]s?|free)\b/.test(normalize(item.title+' '+item.description))))return false;
    const text=normalize([item.title,item.description,item.category,...(item.tags||[])].join(' '));
    if(filters.keywords.length&&!filters.keywords.every(term=>text.includes(term)))return false;
    if(item.kind==='news'&&filters.when){
      if(!item.publishedAt)return false;
      if(filters.when==='today'&&(dateNY(item.publishedAt)!==dateNY(now)||! /\b(hoy|today|hoje)\b/.test(text)))return false;
      if(filters.when==='tomorrow'&&dateNY(item.publishedAt)!==dateNY(now))return false;
      if(filters.when==='weekend'&&(now-new Date(item.publishedAt)>7*86400000||new Date(item.publishedAt)>now))return false;
      if(filters.when==='tomorrow'&&!/\b(manana|tomorrow|amanha)\b/.test(text))return false;
      if(filters.when==='weekend'&&!/\b(fin de semana|weekend|sabado|domingo|viernes)\b/.test(text))return false;
    }
    return true;
  });
}
module.exports={normalize,TOPICS,classify,filtersFor,matching,itemRegion,dateNY,GENERIC,REJECT,namedItems};
