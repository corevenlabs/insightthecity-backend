const {test}=require('node:test');
const assert=require('node:assert/strict');
const language=require('../services/content-language.service');
const translator=()=>{let calls=0;const saved=new Map();return {saved,get calls(){return calls;},run:language.createTranslator({query:async(sql,params)=>{const id=params.slice(0,2).join(':');if(sql.startsWith('SELECT'))return {rows:saved.has(id)?[{translated_text:saved.get(id)}]:[]};saved.set(id,params[2]);return {rows:[]};},translate:async(text,lang)=>{calls++;return `${lang}: ${text}`;}})};};
test('Spanish bypasses translation, unsupported languages do not reach provider',async()=>{const t=translator();assert.equal(await t.run('15% OFF','es'),'15% OFF');assert.equal(await t.run('15% OFF','xx'),'15% OFF');assert.equal(t.calls,0);});
test('Translations cached by original content and language; edits invalidate cache',async()=>{const t=translator();assert.equal(await t.run('15% OFF','en'),'en: 15% OFF');await t.run('15% OFF','en');assert.equal(t.calls,1);await t.run('15% OFF','pt');await t.run('20% OFF','en');assert.equal(t.calls,3);assert.equal(t.saved.size,3);});
test('Concurrent requests coalesce and failed translations can retry',async()=>{const t=translator();await Promise.all([t.run('Museo','en'),t.run('Museo','en')]);assert.equal(t.calls,1);let calls=0;const run=language.createTranslator({query:async()=>({rows:[]}),translate:async()=>{if(++calls===1)throw Error('offline');return 'Museum';}});await assert.rejects(run('Museo','en'));assert.equal(await run('Museo','en'),'Museum');});
test('Benefit amounts cannot silently change in translation',async()=>{const run=language.createTranslator({query:async()=>({rows:[]}),translate:async()=> '50% OFF'});await assert.rejects(run('15% OFF','en'),/numeric terms/);});
test('Only editorial fields translated; identifiers, prices, category, addresses and links intact',async()=>{const original={id:'x',title:'Nuyores',category:'Comida',tags:['Comida','NY'],date:'Hoy',location:'100 West St',description:'Comida peruana',memberBenefit:'15% OFF',memberBenefitDetails:'Mínimo $50',includes:['Entrada'],access:'premium',priceCents:120000,image:'https://example.com/photo.jpg',benefitUrl:'https://example.com/redeem'};const result=await language.experience(original,'pt',async x=>`pt: ${x}`);for(const field of ['id','title','category','tags','location','priceCents','image','benefitUrl','access'])assert.deepEqual(result[field],original[field]);assert.equal(result.description,'pt: Comida peruana');assert.equal(result.originalDate,'Hoy');assert.equal(original.description,'Comida peruana');});
test('HTML articles preserve separate original matching metadata',async()=>{const article={title:'Museos gratis',excerpt:'Entrada gratis',contentHtml:'<p>Entrada $0</p>',image:'https://example.com/image'};const result=await language.article(article,'en',async(text,lang,html)=>{if(html)assert.match(text,/<p>/);return text.replace('Entrada','Entry').replace('Museos gratis','Free museums');});assert.equal(result.originalTitle,'Museos gratis');assert.equal(result.contentHtml,'<p>Entry $0</p>');assert.equal(result.image,article.image);});

test('Venue name remains intact while its editorial subtitle is localized',async()=>{const item={title:'RiseNY: descubre Nueva York',access:'premium',description:'Museo'};const result=await language.experience(item,'en',async text=>text==='descubre Nueva York'?'discover New York':'Museum');assert.equal(result.title,'RiseNY: discover New York');assert.equal(item.title,'RiseNY: descubre Nueva York');});

test('Dollar amounts and percentages are restored literally and currency conversion is rejected',async()=>{const protectedText=language.protectValues('15% OFF con mínimo $50',false);assert.equal(protectedText.source,'[[ITC_VALUE_0]] OFF con mínimo [[ITC_VALUE_1]]');assert.equal(protectedText.restore('[[ITC_VALUE_0]] OFF com mínimo [[ITC_VALUE_1]]'),'15% OFF com mínimo $50');assert.throws(()=>protectedText.restore('R$50'),/protected value/);const run=language.createTranslator({query:async()=>({rows:[]}),translate:async()=> 'Mínimo R$50'});await assert.rejects(run('Mínimo $50','pt'),/currency/);});
test('Protection leaves article URLs and attributes untouched',()=>{const source='<a href="https://example.com/2026" class="x2">15% OFF $50</a>';const masked=language.protectValues(source,true);assert.ok(masked.source.includes('href="https://example.com/2026" class="x2"'));assert.equal(masked.restore(masked.source),source);});

test('Legal reading translation retains published source and acceptance snapshot matches displayed content',async()=>{
 const db=require('../config/db'),legal=require('../services/legal.service');const originalQuery=db.query,originalTranslate=language.translateText;
 const source={id:44,slug:'privacy',language:'es',version:2,title:'Privacidad',content:'Datos del Club',published_at:'2026-10-01'};
 try{
  db.query=async()=>({rows:[source]});language.translateText=async text=>'pt: '+text;
  const shown=await legal.getCurrent('privacy','pt');assert.equal(shown.id,44);assert.equal(shown.language,'pt');assert.equal(shown.sourceLanguage,'es');assert.equal(shown.sourceVersion,2);assert.equal(shown.content,'pt: Datos del Club');assert.equal(source.content,'Datos del Club');assert.match(shown.sourceContentHash,/^[a-f0-9]{64}$/);
  let snapshot;await legal.recordAcceptance({query:async(sql,params)=>{snapshot=JSON.parse(params[6]);return {rows:[]};}},{userId:1,language:'pt',context:'register',slugs:['privacy']});assert.deepEqual(snapshot,JSON.parse(JSON.stringify(shown)));
 }finally{db.query=originalQuery;language.translateText=originalTranslate;}
});

test('Reconstruction owns the numbers, currency, emails, URLs, entities and literal separators',async()=>{
 const id=require.resolve('../config/openai'),previous=require.cache[id];let sent=[];
 require.cache[id]={id,filename:id,loaded:true,exports:{responses:{create:async request=>{assert.ok(Object.values(request.text.format.schema.properties).every(property=>new RegExp(property.pattern).test('Human text')&&!new RegExp(property.pattern).test('  ')&&!new RegExp(property.pattern).test('$50')));const data=JSON.parse(request.input);sent.push(...Object.values(data));return {status:'completed',output_text:JSON.stringify(Object.fromEntries(Object.entries(data).map(([key,text])=>[key,text.replace('Mínimo','Minimum').replace('Contacto','Contact')])))};}}}};
 try{
  const source='<p>Mínimo $50 > 20% &amp; Contacto soporte@example.com https://example.com/2026</p>';
  const result=await language.translatePublishedText(source,'en',true);assert.equal(result,'<p>Minimum $50 > 20% &amp; Contact soporte@example.com https://example.com/2026</p>');assert.ok(sent.every(value=>!/[0-9$<>@]/.test(value)));
 }finally{if(previous)require.cache[id]=previous;else delete require.cache[id];}
});

test('A transient malformed provider response retries without caching or returning broken text',async()=>{
 const id=require.resolve('../config/openai'),previous=require.cache[id];let calls=0;
 require.cache[id]={id,filename:id,loaded:true,exports:{responses:{create:async request=>{calls++;return {status:'completed',output_text:calls===1?'invalid JSON':JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(request.input)).map(key=>[key,'Museum'])))};}}}};
 try{assert.equal(await language.translatePublishedText('Museo','en',false),'Museum');assert.equal(calls,2);}finally{if(previous)require.cache[id]=previous;else delete require.cache[id];}
});
