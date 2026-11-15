const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../services/external-benefit-link');
const {page}=require('../services/external-benefit-page');
const now=Date.parse('2026-11-15T15:00:00Z');
test('schedule is based on server instants with precise inclusive start and exclusive end',()=>{
 const starts='2026-11-15T15:00:00Z',ends='2026-11-15T16:00:00Z';
 const row={external_benefit_starts_at:starts,external_benefit_ends_at:ends};
 assert.equal(L.phase(row,now-1),'scheduled');assert.equal(L.phase(row,now),'available');assert.equal(L.phase(row,Date.parse(ends)),'expired');
 assert.equal(L.phase({},now),'available');assert.equal(L.phase({...row,external_benefit_starts_at:'bad'},now),'unavailable');
 assert.equal(L.phase({...row,external_benefit_ends_at:starts},now),'unavailable');
});
test('only explicitly dated premium external links are wrapped; QR and undated links remain identical',()=>{
 const row={id:'example',access:'premium',benefitAction:'external',benefitUrl:'https://partner.example/pay?coupon=SAVE&x=1'};
 assert.equal(L.publicView(row,'es'),row);
 const dated={...row,externalBenefitStartsAt:'2026-11-20T00:00:00Z'};
 for(const lang of ['es','en','pt']){
  const u=new URL(L.publicView(dated,lang).benefitUrl);assert.equal(u.pathname,'/benefits/link/example');assert.equal(u.searchParams.get('lang'),lang);
 }
 const qr={...dated,benefitAction:'qr'};assert.equal(L.publicView(qr,'es'),qr);
 const free={...dated,access:'free'};assert.equal(L.publicView(free,'es'),free);
 const tickets=L.publicView({...dated,isPaidEvent:true,ticketUrl:'https://partner.example/tickets'},'es');assert.equal(new URL(tickets.ticketUrl).searchParams.get('target'),'tickets');
});
test('dates require timezone and a real calendar day, and DST offsets are respected',()=>{
 for(const value of ['',123,'2026-11-15T12:00','2026-02-30T12:00:00Z','2026-13-01T12:00:00Z','2026-11-15T25:00:00Z'])assert.equal(L.validDate(value),false,String(value));
 for(const value of [null,undefined,'2028-02-29T12:00:00Z','2026-11-01T01:30:00-04:00'])assert.equal(L.validDate(value),true);
 assert.equal(L.validation({externalBenefitStartsAt:'2026-11-01T01:30:00-04:00',externalBenefitEndsAt:'2026-11-01T01:30:00-05:00'}),null);
 assert.match(L.validation({externalBenefitStartsAt:'2026-11-16T00:00:00Z',externalBenefitEndsAt:'2026-11-15T00:00:00Z'}),/posterior/);
});
test('destination comes only from stored secure URLs and never loops through the gate',()=>{
 const value='https://partner.example/pay?coupon=SAVE100&ref=abc%2Fdef';assert.equal(L.destination(value),value);
 for(const bad of ['http://partner.example','javascript:alert(1)','https://user:pass@partner.example',L.url('example','es')])assert.equal(L.destination(bad),null);
});
test('status pages are localized, escaped and do not reveal a payment link outside its window',()=>{
 const row={id:'example',title:'<script>unsafe</script>',external_benefit_starts_at:'2026-11-20T15:00:00Z',external_benefit_ends_at:'2026-12-20T15:00:00Z',benefit_url:'https://partner.example/private-coupon'};
 for(const [lang,start,end] of [['es','Próximamente','Beneficio finalizado'],['en','Coming soon','Benefit ended'],['pt','Em breve','Benefício encerrado']]){
  const html=page({row,lang,state:'scheduled',target:'tickets'});assert.match(html,new RegExp(start));assert.match(html,new RegExp(`<html lang="${lang}"`));
  assert.doesNotMatch(html,/<script>|private-coupon/);assert.match(html,/&lt;script&gt;/);assert.match(html,/target=tickets/);
  assert.match(page({row,lang,state:'expired'}),new RegExp(end));
 }
});
