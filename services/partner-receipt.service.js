const crypto = require('node:crypto');
const path = require('node:path');
const PDF = require('pdfkit');
const { paymentAmounts, settledPayment } = require('./partner-payment-amounts');
const clean = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g,' ').trim() : '';
const address = v => v ? ['line1','line2','city','state','postal_code','country'].map(k=>clean(v[k])).filter(Boolean).join(', ') : '';
const idOf = v => typeof v === 'string' ? v : v?.id || null;
function snapshot({ session:s, account:a }, client) {
  const amounts=paymentAmounts(s,client), free=client.offer==='strategic' && client.amount_cents===0;
  if(!amounts || s.mode!=='payment' || s.status!=='complete' || s.currency!=='usd' || !settledPayment(s,free) || !a?.id || !s.id || (s.customer_details?.email||s.customer_email||'').toLowerCase()!==client.email) throw Error('Receipt data does not match the verified partner payment');
  const intent=s.payment_intent, charge=typeof intent==='object' && intent ? intent.latest_charge : null;
  if(!free && (!charge || typeof charge!=='object' || !charge.paid || charge.currency!==s.currency || charge.amount!==s.amount_total || intent.status!=='succeeded')) throw Error('Receipt requires a matching successful Stripe charge');
  const issuerName=clean(a.company?.name || a.business_profile?.name || a.settings?.dashboard?.display_name);
  if(!issuerName) throw Error('Stripe account business name is unavailable');
  const payer=s.customer_details||{}, card=charge?.payment_method_details?.card, bank=charge?.payment_method_details?.us_bank_account, time=charge?.created||s.created;
  if(!Number.isInteger(time)||time<=0) throw Error('Stripe transaction timestamp is unavailable');
  if(amounts.subtotal===null) throw Error('Receipt requires actual Stripe subtotal and discount');
  return {
    version:1, reference:`ITC-${crypto.createHash('sha256').update(s.id).digest('hex').slice(0,20).toUpperCase()}`,
    sessionId:s.id, stripeAccountId:a.id, paymentIntentId:idOf(intent), chargeId:idOf(charge),
    stripeReceiptNumber:clean(charge?.receipt_number), stripeReceiptUrl:clean(charge?.receipt_url),
    livemode:Boolean(s.livemode), kind:free?'participation':'payment', transactionAt:new Date(time*1000).toISOString(), confirmedAt:new Date().toISOString(),
    issuer:{name:issuerName,address:address(a.business_profile?.support_address||a.company?.address||a.individual?.address),email:clean(a.business_profile?.support_email),phone:clean(a.business_profile?.support_phone)},
    payer:{name:clean(payer.name||charge?.billing_details?.name),businessName:clean(payer.business_name),email:clean(payer.email||s.customer_email),address:address(payer.address||charge?.billing_details?.address),phone:clean(payer.phone),taxIds:(payer.tax_ids||[]).map(t=>({type:clean(t.type),value:clean(t.value)})).filter(t=>t.value)},
    businessName:clean(client.business_name), partnerType:free?'Strategic Founding Partner':'Founding Partner', description:clean(s.line_items?.data?.[0]?.description),
    paymentMethod:free?'No payment required':[clean(charge.payment_method_details?.type),clean(card?.brand),card?.last4||bank?.last4?`ending in ${clean(card?.last4||bank?.last4)}`:''].filter(Boolean).join(' - '), amounts,
  };
}
function filename(r){return `ITC-Club-${r.kind==='payment'?'Payment-Receipt':'Participation-Confirmation'}-${r.reference}.pdf`;}
function pdf(r){return new Promise((resolve,reject)=>{
  const doc=new PDF({size:'LETTER',margin:44,bufferPages:true,info:{Title:r.kind==='payment'?'ITC Club Payment Receipt':'ITC Club Participation Confirmation',Author:r.issuer.name}}),chunks=[];
  doc.on('data',b=>chunks.push(b));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  const x=44,w=524,right=568;
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:r.amounts.currency}).format(n/100);
  const date=v=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(v));
  doc.rect(x,44,w,84).fill('#080808');doc.image(path.join(__dirname,'../public/email/itc-club-logo-v1.png'),54,53,{fit:[100,66]});
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#fff').text(r.kind==='payment'?'PAYMENT RECEIPT':'PARTICIPATION CONFIRMATION',170,72,{width:380,align:'right'});doc.rect(360,101,190,3).fill('#FDDD56');doc.x=x;doc.y=145;
  function text(v,size=10,bold=false,color='#222'){doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color);if(doc.y+doc.heightOfString(v,{width:w,lineGap:2})>708){doc.addPage();doc.x=x;doc.y=44;}doc.text(v,x,doc.y,{width:w,lineGap:2}).moveDown(0.3);}
  if(!r.livemode)text('TEST MODE - No real payment collected',11,true,'#8B6500');
  text('Thank you for your partnership.',21,true);text(`${r.partnerType} - Six-month participation`,11,false,'#666');
  const top=doc.y+6,cw=250,issuer=[r.issuer.name,r.issuer.address,r.issuer.email,r.issuer.phone].filter(Boolean).join('\n'),payer=[r.payer.businessName,r.payer.name,r.payer.email,r.payer.address,r.payer.phone,...r.payer.taxIds.map(t=>`${t.type}: ${t.value}`)].filter(Boolean).join('\n');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666').text('ISSUED BY',x,top,{width:cw}).text(r.kind==='payment'?'PAID BY / CHECKOUT DETAILS':'PARTICIPANT / CHECKOUT DETAILS',318,top,{width:cw});doc.font('Helvetica').fontSize(10).fillColor('#222');
  const h=Math.max(doc.heightOfString(issuer,{width:cw,lineGap:2}),doc.heightOfString(payer,{width:cw,lineGap:2}));doc.text(issuer,x,top+18,{width:cw,lineGap:2}).text(payer,318,top+18,{width:cw,lineGap:2});doc.x=x;doc.y=top+h+32;
  text(`Business profile: ${r.businessName}`,10,true);text(`Receipt reference: ${r.reference}`,9);text(`${r.kind==='payment'?'Transaction':'Checkout'} date (Stripe): ${date(r.transactionAt)}`,9);text(`Confirmation recorded: ${date(r.confirmedAt)}`,9,false,'#666');if(r.description)text(`Stripe item: ${r.description}`,10);
  if(doc.y+165>708){doc.addPage();doc.x=x;doc.y=44;}let y=doc.y+5;
  doc.rect(x,y,w,26).fill('#FDDD56');doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text('DESCRIPTION',x+10,y+8,{width:365}).text(`AMOUNT (${r.amounts.currency.toUpperCase()})`,430,y+8,{width:128,align:'right'});y+=26;
  const percent=r.amounts.subtotal?Math.round(r.amounts.discount/r.amounts.subtotal*100):0;
  for(const [label,value] of [['Participation fee',r.amounts.subtotal],[`Invitation discount (${percent}%)`,-r.amounts.discount],['Tax calculated by Stripe',r.amounts.tax]]){doc.moveTo(x,y+27).lineTo(right,y+27).strokeColor('#ddd').stroke();doc.font('Helvetica').fontSize(10).fillColor('#222').text(label,x+10,y+9,{width:365}).text(money(value),430,y+9,{width:128,align:'right'});y+=28;}
  doc.rect(x,y,w,36).fill('#FFF6C8');doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(r.kind==='payment'?'TOTAL PAID':'TOTAL DUE',x+10,y+11,{width:270}).text(money(r.amounts.total),400,y+9,{width:158,align:'right'});doc.x=x;doc.y=y+48;
  text(r.kind==='payment'?'PAYMENT CONFIRMED':'PARTICIPATION CONFIRMED - NO PAYMENT REQUIRED',10,true);text(`Payment method: ${r.paymentMethod}`,9);if(r.paymentIntentId)text(`Stripe payment reference: ${r.paymentIntentId}`,8);if(r.chargeId)text(`Stripe charge reference: ${r.chargeId}`,8);text(`Stripe Checkout: ${r.sessionId}`,8);if(r.stripeReceiptNumber)text(`Stripe receipt number: ${r.stripeReceiptNumber}`,9);
  if(r.stripeReceiptUrl.startsWith('https://'))doc.font('Helvetica').fontSize(9).fillColor('#786400').text('View the corresponding Stripe receipt',x,doc.y,{link:r.stripeReceiptUrl,underline:true,width:w}).moveDown();
  text('The six-month participation period starts when your business profile is activated. This is not an automatically renewing subscription.',9,false,'#555');
  text(r.kind==='payment'?'Receipt issued for a payment processed through Stripe. The total is the amount paid by the customer, before any processing fees deducted from the recipient.':'Confirmation of a fully discounted participation. No funds were collected.',8,false,'#666');
  const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.moveTo(x,738).lineTo(right,738).strokeColor('#FDDD56').stroke();doc.font('Helvetica').fontSize(8).fillColor('#777').text(`ITC Club | ${i+1} / ${pages.count}`,x,748,{lineBreak:false});}doc.end();
});}
module.exports={snapshot,filename,pdf};
