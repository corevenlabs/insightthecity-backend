const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeExperienceText}=require('../utils/experienceText');
const errors=require('../middleware/manejadorErrores');
test('pasted NULs are removed only from editorial text, including tags, includes and branch addresses',()=>{
 const body={title:'Broad\u0000way',description:'Música 🎭\u0000\nSão Paulo — acción 👨‍👩‍👧‍👦 e\u0301',tags:['FO\u0000OD'],includes:['Entrada\u0000 general'],locations:[{name:'Sucursal\u0000',address:'Nueva\u0000 York',placeId:'valid-ID',benefitApplies:true}],couponActive:false,couponTotal:0,endsAt:null};
 const clean=normalizeExperienceText(body);
 assert.equal(clean.title,'Broadway');assert.equal(clean.description,'Música 🎭\nSão Paulo — acción 👨‍👩‍👧‍👦 e\u0301');
 assert.deepEqual(clean.tags,['FOOD']);assert.deepEqual(clean.includes,['Entrada general']);assert.equal(clean.locations[0].address,'Nueva York');
 assert.equal(body.title,'Broad\u0000way');assert.equal(clean.couponActive,false);assert.equal(clean.couponTotal,0);assert.equal(clean.endsAt,null);
});
test('valid content is unchanged, including literal escape notation, ZWJ emoji, accents and other invisible Unicode',()=>{
 const body={title:'Café 🎭',description:'Literal \\u0000, ñ á São, zero-width \u200b and NBSP \u00a0',tags:['BROADWAY'],images:['https://example.test/a.jpg'],benefitUrl:'https://example.test/?a=%00',unknown:{safe:true}};
 assert.deepEqual(normalizeExperienceText(body),body);
});
test('URLs and identifiers are rejected with a field-specific error, never silently rewritten',()=>{
 for(const [field,value] of Object.entries({benefitUrl:'https://a.test/\u0000b',images:['https://a.test/\u0000b'],id:'a\u0000b',client_id:'a\u0000b',endsAt:'2026\u0000',locations:[{placeId:'id\u0000'}]}))
  assert.throws(()=>normalizeExperienceText({[field]:value}),e=>e.status===400 && /carácter invisible/.test(e.message));
 assert.throws(()=>normalizeExperienceText({benefitUrl:'https://a.test/\u0000'}),/enlace del beneficio/);
});
test('unanticipated database character errors give a useful 400 without disclosing SQL details',()=>{
 for(const code of ['22021','22P05']){
  let status,body;const response={status:s=>(status=s,response),json:b=>(body=b)};
  const prior=console.error;console.error=()=>{};
  try{errors({code,message:'private database details'},null,response,()=>{});}finally{console.error=prior;}
  assert.equal(status,400);assert.match(body.message,/carácter no válido/);assert.doesNotMatch(body.message,/private/);
 }
});
