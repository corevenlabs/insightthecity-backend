const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const E=require('../services/partner-external-agreement');
const [spec]=require('../config/partner-external-agreements.json');
const rowFor=(extra={})=>({id:spec.clientId,link_version:spec.invitationVersion,business_name:spec.businessName,category:'strategic',offer:'strategic',amount_cents:0,payment_method:'waived',payment_status:'waived',form_status:'invited',terms_snapshot:{en:{title:'Standard terms',content:'Six month contract',version:1}},contact_name:'Contact',email:'contact@example.com',language:'en',owner_id:1,link_expires_at:new Date(Date.now()+86400000),content:{},submission_version:0,...extra});
function service(row){
 const queries=[],queued=[],activity=[],acceptances=[];let stripeCalls=0;
 const session={id:'cs_exact',client_reference_id:'exact-reference',mode:'payment',status:'complete',payment_status:'no_payment_required',livemode:true,currency:'usd',customer_email:row.email,amount_subtotal:180000,amount_total:0,total_details:{amount_discount:180000,amount_tax:0,amount_shipping:0},automatic_tax:{enabled:true,status:'complete'},metadata:{partner_id:row.id}};
 const db={connect:async()=>({...db,release(){}}),query:async(sql,args=[])=>{
  queries.push([sql,args]);
  if(sql.startsWith('SELECT * FROM partner_clients'))return {rows:[row]};
  if(sql.includes('FROM admins'))return {rows:[{id:1,name:'Executive',email:'executive@example.com'}]};
  if(sql.includes('FROM partner_files'))return {rows:sql.includes('kind,bytes')?[{kind:'logo',bytes:Buffer.from('logo')},...[1,2,3,4].map(x=>({kind:'photo',bytes:Buffer.from(String(x))}))]:[]};
  if(sql.startsWith('SELECT signer_name'))return {rows:[]};
  if(sql.startsWith('SELECT * FROM partner_acceptances'))return {rows:[]};
  if(sql.startsWith('SELECT id FROM partner_acceptances'))return {rows:[]};
  if(sql.startsWith('INSERT INTO partner_acceptances')){acceptances.push([sql,args]);return {rows:[{id:'acceptance'}]};}
  if(sql.includes("INSERT INTO partner_activity")){activity.push({sql,args});return {rows:[]};}
  if(sql.startsWith('SELECT note FROM partner_activity'))return {rows:activity.filter(x=>x.sql.includes('external-agreement-confirmed')).map(x=>({note:x.args?.[1]}))};
  if(sql.includes('SET stripe_session_id=$2,stripe_partner_customer_id'))row.stripe_session_id=args[1];
  if(sql.includes('SET stripe_session_id=$2,stripe_payment_intent')){row.payment_verified_at=new Date();row.payment_status=args[3];}
  if(sql.includes('SET content=$2')){row.content=JSON.parse(args[1]);row.form_status=args[3];}
  return {rows:[]};
 }};
 const L={presentation:r=>r.payment_verified_at?{}:{payment_method:'stripe',payment_status:'pending'},manualFor:()=>false,serverCheckout:()=>true,configured:()=>true,testMode:()=>false,reference:()=> 'exact-reference',strategicCheckout:r=>r.offer==='strategic'&&!r.payment_verified_at&&r.form_status==='invited',isSession:()=>true,isServerSession:()=>true,clientId:()=>row.id};
 const native=createRequire(require.resolve('../services/partner-crm.service'));
 const rules=native('./partner-rules');
 const module={exports:{}};
 const req=p=>{
  if(p==='../config/db')return db;
  if(p==='jsonwebtoken')return {verify:()=>({type:'partner',id:row.id,v:row.link_version}),sign:()=> 'private-test-token'};
  if(p==='./partner-payment-link.service')return L;
  if(p==='./partner-email.service')return {PANEL:()=> 'https://panel.example',queue:async(c,data)=>queued.push(data),flush:async()=>{}};
  if(p==='./partner-rules')return {...rules,content:x=>x};
  if(p==='./stripe.service')return {listPartnerPaymentLinkSessions:async function*(){},listOpenPartnerSessions:async function*(){},createServerPartnerCheckout:async()=>{stripeCalls++;return {session:{id:session.id,url:'https://checkout.stripe.com/test'},customerId:'customer',attempt:1};},retrievePartnerReceiptData:async()=>({session})};
  if(p==='./partner-receipt.service')return {snapshot:()=>({verified:true})};
  return native(p);
 };
 vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(require.resolve('../services/partner-crm.service'),'utf8')}\n})`, {process, Buffer, console})(req,module,module.exports);
 return {S:module.exports,row,session,queries,queued,activity,acceptances,stripeCalls:()=>stripeCalls};
}
test('exception requires exact client, business, invitation and strategic zero-dollar offer',()=>{
 const row=rowFor();assert.ok(E.agreement(row));
 for(const extra of [{id:'other'},{link_version:spec.previousInvitationVersion},{business_name:'Other'},{category:'partner'},{offer:'founding'},{amount_cents:30000}])assert.equal(E.agreement({...row,...extra}),null);
});
test('special invitation keeps Stripe and form locked before confirmation; no standard terms exposed',async()=>{
 const t=service(rowFor());const view=await t.S.publicView('token');
 assert.equal(view.agreement_mode,'external');assert.equal(view.payment_status,'pending');assert.deepEqual(Object.keys(view.terms),[]);
 await assert.rejects(t.S.save('token',{content:{}}),/no está disponible/);
 const checkout=await t.S.checkout('token',{signerName:'Client',accept:false});
 assert.match(checkout.url,/checkout.stripe.com/);assert.equal(t.stripeCalls(),1);
 assert.equal(t.acceptances.length,0);assert.ok(t.activity.some(x=>x.sql.includes('external-agreement-confirmed')));
 assert.equal(t.queued.length,0);
});
test('special invitation still requires confirmation name',async()=>{
 const t=service(rowFor());await assert.rejects(t.S.checkout('token',{accept:false}),/Indica tu nombre/);assert.equal(t.stripeCalls(),0);
});
test('other invitation versions still require standard commercial consent',async()=>{
 const t=service(rowFor({link_version:spec.previousInvitationVersion}));
 assert.equal((await t.S.publicView('token')).agreement_mode,undefined);
 await assert.rejects(t.S.checkout('token',{signerName:'Client',accept:false,agreement_mode:'external'}),/Acepta el acuerdo/);
 assert.equal(t.stripeCalls(),0);
 await t.S.checkout('token',{signerName:'Client',accept:true});
 assert.equal(t.acceptances.length,1);assert.equal(t.queued[0].kind,'accepted_terms');
});
test('webhook requires explicit external confirmation and validates zero total/discount before unlocking',async()=>{
 const t=service(rowFor({stripe_session_id:'cs_exact'}));
 assert.equal(await t.S.confirmPaymentLink(t.session),false);
 await E.confirm({query:async(sql,args)=>{t.activity.push({sql,args});return {rows:[]};}},t.row,'Client','exact-reference');
 await assert.rejects(t.S.confirmPaymentLink({...t.session,amount_total:180000}),/no coincide/);
 await assert.rejects(t.S.confirmPaymentLink({...t.session,total_details:{...t.session.total_details,amount_discount:0}}),/no coincide/);
 await assert.rejects(t.S.confirmPaymentLink({...t.session,customer_email:'other@example.com'}),/no coincide/);
 t.session.customer_email=t.row.email;
 assert.equal(await t.S.confirmPaymentLink(t.session),true);
 assert.ok(t.row.payment_verified_at);assert.equal(t.row.payment_status,'waived');assert.equal(t.queued[0].kind,'invite');
 await t.S.save('token',{content:{businessName:'Business',contactName:'Client'},language:'en'});
 assert.equal(t.row.form_status,'draft');
 await assert.rejects(t.S.save('token',{content:{},authorize:false},true),/Autoriza/);
 await t.S.save('token',{content:{contactName:'Client'},authorize:true,language:'en'},true);
 assert.equal(t.row.form_status,'submitted');
 const doc=JSON.parse(t.acceptances[0][1][4]);assert.equal(doc.agreementSource,'external-reported-by-itc');assert.equal(doc.content,undefined);assert.equal(doc.type,'material-authorization');
});
test('normal invitations cannot use external activity as payment consent',async()=>{
 const t=service(rowFor({id:'11111111-1111-4111-8111-111111111111',stripe_session_id:'cs_exact'}));
 t.session.customer_email=t.row.email;t.activity.push({sql:'external-agreement-confirmed'});
 assert.equal(await t.S.confirmPaymentLink(t.session),false);assert.equal(t.row.payment_verified_at,undefined);
});

test('external confirmation must match invitation, payment reference and agreement; malformed notes are ignored',async()=>{
 const row=rowFor();let note={agreementReference:spec.reference,invitationVersion:row.link_version,paymentLinkReference:'exact',confirmedBy:'Client'};
 const c={query:async()=>({rows:[{note:'invalid history'},{note:JSON.stringify(note)}]})};
 assert.equal(await E.confirmation(c,row,'exact'),true);
 assert.equal(await E.confirmation(c,row,'other'),false);
 note={...note,invitationVersion:spec.previousInvitationVersion};assert.equal(await E.confirmation(c,row,'exact'),false);
 note={...note,invitationVersion:row.link_version,agreementReference:'other'};assert.equal(await E.confirmation(c,row,'exact'),false);
});
