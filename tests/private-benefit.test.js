const {test}=require('node:test');const assert=require('node:assert/strict');const jwt=require('jsonwebtoken');
const P=require('../services/private-benefit.service');const {experienceItem}=require('../services/chat.service');
const code='MEMBER_PRIVATE987';
const row={id:'venue',access:'premium',benefit_action:'external',private_benefit_code:code,member_benefit:'Special offer',member_benefit_details:'Use '+code,description:'Go with '+code,is_published:true,benefit_url:'https://partner.example/pay',title:'Venue',image_url:'https://image.example/a.jpg'};
test('all public projections and YORKi exclude private code and redemption URLs; only staff projection includes the code',()=>{
 const record={id:'venue',access:'premium',benefitAction:'external',memberBenefit:row.member_benefit,memberBenefitDetails:row.member_benefit_details,description:row.description,benefitUrl:'https://partner.example/'+code,ticketUrl:'https://partner.example/?code='+code};
 const output=P.publicRecord(row,record);assert.doesNotMatch(JSON.stringify(output),new RegExp(code));assert.equal(output.benefitUrl,null);assert.equal(output.privateBenefitRequired,true);assert.ok(!('privateBenefitCode'in output));
 assert.equal(P.publicRecord(row,record,true).privateBenefitCode,code);
 assert.doesNotMatch(JSON.stringify(experienceItem(row,Date.now())),new RegExp(code));
 const legacy={...row,private_benefit_code:null,member_benefit:'COD: '+code};assert.equal(P.codeFor(legacy),code);assert.equal(P.publicRecord(legacy,record).memberBenefit,'Beneficio exclusivo para miembros ITC Club');
 const qr={...row,benefit_action:'qr'};assert.equal(P.codeFor(qr),null);assert.equal(P.publicRecord(qr,record),record);
});
test('public-label validation prevents legacy code labels and private-code duplicates',()=>{
 assert.match(P.validation({benefitAction:'external',memberBenefit:'COD: '+code}),/Código de descuento/);
 assert.match(P.validation({benefitAction:'external',privateBenefitCode:code,memberBenefitDetails:'Use '+code}),/textos públicos/);
 assert.equal(P.validation({access:'premium',benefitAction:'external',privateBenefitCode:code,memberBenefit:'Special offer'}),null);
 assert.match(P.validation({benefitAction:'qr',privateBenefitCode:code}),/enlace externo/);
});
test('signed links have a five-minute limit and a separate purpose, with no code or bearer in claims',()=>{
 const prior=process.env.JWT_SECRET;process.env.JWT_SECRET='local-test-only';
 try{
  const record=P.memberRecord(row,{privateBenefitRequired:true},{id:1,session_version:3},'es');const token=new URL(record.benefitUrl).searchParams.get('grant');const claims=jwt.verify(token,process.env.JWT_SECRET);
  assert.equal(claims.type,'private_benefit_link');assert.equal(claims.target,'benefit');assert.equal(claims.exp-claims.iat,300);assert.equal(claims.sv,3);assert.doesNotMatch(JSON.stringify(claims),new RegExp(code));assert.equal(record.privateBenefitCode,code);
 }finally{if(prior===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=prior;}
});

test('codes containing regular-expression characters are redacted literally',()=>{ const coded={...row,private_benefit_code:'A+B.123'}; const result=P.publicRecord(coded,{description:'Use A+B.123 now'}); assert.ok(!result.description.includes('A+B.123')); });
