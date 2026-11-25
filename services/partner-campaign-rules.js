const {fail,clean}=require('./partner-rules');
const idOf=v=>typeof v==='string'?v:v?.id;
const isCampaign=row=>row?.offer==='campaign';
const EMAILS={
 payment:{subject:'Your invitation to {campaign}',title:'Let’s grow together.',body:'Review your invitation and participation terms for {business}. Your initial contribution is {price}.'},
 invite:{subject:'Welcome to {campaign}',title:'Welcome to ITC Club.',body:'Your first payment is confirmed. Complete your business profile and upload your photos so we can prepare your publication.'},
 received:{subject:'We received your profile | {campaign}',title:'Your profile is with our team.',body:'Thanks for sharing your business information. We’ll review it and contact you if anything else is needed.'},
 changes:{subject:'A small update to your profile | {campaign}',title:'Let’s get your profile ready.',body:'Please review the requested updates below and resubmit your business profile.'},
 published:{subject:'Your business is live | {campaign}',title:'Welcome to the spotlight.',body:'Your business profile is now available in ITC Club. You can review your publication dates below.'},
 payment_paid:{subject:'Payment confirmed | {campaign}',title:'Your payment is confirmed.',body:'Your payment has been received. Your receipt is attached and the original Stripe invoice is available below.'},
 payment_failed:{subject:'Action needed: payment pending | {campaign}',title:'We couldn’t process your payment.',body:'Please resolve your outstanding payment. A previously published profile is temporarily hidden until all pending payments are confirmed.'},
 payment_recovered:{subject:'Payment received | {campaign}',title:'Thank you. Payment received.',body:'Your payment is confirmed. A previously published profile can be restored if no other payment or administrative restriction applies.'},
 renewal_notice:{subject:'Your upcoming renewal | {campaign}',title:'Your next chapter is coming.',body:'Your initial publication period is ending. Unless you cancel renewal before the next charge, your participation continues at {renewalPrice} per month. Contact our team to cancel renewal.'},
 cancellation:{subject:'Renewal canceled | {campaign}',title:'Your cancellation is confirmed.',body:'There will be no future renewal charges. Your publication continues until the end of the current paid period.'},
 ended:{subject:'Participation ended | {campaign}',title:'Thank you for being part of ITC Club.',body:'Your publication period has ended and your profile is no longer visible in the app.'},
};
function integer(v,min,max,label){const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>max)fail(`Revisa ${label}`);return n;}
function config(input){
 const c={name:clean(input?.name,150),description:clean(input?.description,1500),currency:input?.currency||'usd',mode:input?.mode,
 normalPriceCents:integer(input?.normalPriceCents,50,50000000,'el precio normal'),priceCents:integer(input?.priceCents,50,50000000,'el precio promocional'),
 installments:input?.mode==='one_time'?1:integer(input?.installments,2,24,'el número de cuotas'),publicationMonths:integer(input?.publicationMonths,1,36,'la duración de publicación'),
 publicationStart:input?.publicationStart||'publication',renewal:input?.renewal===true,renewalPriceCents:input?.renewal===true?integer(input.renewalPriceCents,50,50000000,'el precio de renovación'):null,
 startsAt:input?.startsAt||null,endsAt:input?.endsAt||null,termsTitle:clean(input?.termsTitle,250),termsContent:clean(input?.termsContent,100000),termsApproved:input?.termsApproved===true,emails:{}};
 if(!c.name||!['usd','eur','brl'].includes(c.currency)||!['one_time','installments'].includes(c.mode)||!['publication','payment'].includes(c.publicationStart))fail('Completa nombre, moneda, modalidad y comienzo de publicación');
 if(c.priceCents>c.normalPriceCents)fail('El precio promocional no puede superar el normal');
 if(c.mode==='installments'&&c.publicationMonths<c.installments)fail('La duración de publicación debe cubrir al menos el número de cuotas mensuales');
 for(const key of ['startsAt','endsAt'])if(c[key]){const d=new Date(c[key]);if(!Number.isFinite(d.getTime()))fail('Revisa las fechas de disponibilidad');c[key]=d.toISOString();}
 if(c.startsAt&&c.endsAt&&c.startsAt>=c.endsAt)fail('La fecha final debe ser posterior a la inicial');
 for(const [kind,defaults] of Object.entries(EMAILS)){
  const supplied=input?.emails?.[kind]||defaults;
  c.emails[kind]={};
  for(const key of ['subject','title','body']){
   const value=clean(supplied[key],key==='body'?6000:250);
   if(!value||/[<>]/.test(value)||/[\r\n]/.test(key==='subject'?value:''))fail('Completa los correos usando texto sin HTML');
   for(const variable of value.match(/\{[^}]+\}/g)||[])if(!['{campaign}','{business}','{price}','{renewalPrice}'].includes(variable))fail(`Variable de correo no admitida: ${variable}`);
   c.emails[kind][key]=value;
  }
 }
 return c;
}
function publishable(c,now=new Date()){
 if(!c.termsApproved||!c.termsTitle||!c.termsContent)fail('Carga y aprueba los términos propios de esta campaña antes de activarla',409);
 if(c.endsAt&&new Date(c.endsAt)<=now)fail('La campaña ya finalizó',409);
}
function available(c,now=new Date()){return (!c.startsAt||new Date(c.startsAt)<=now)&&(!c.endsAt||new Date(c.endsAt)>now);}
function addMonths(input,n){const d=new Date(input),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d;}
function money(n,currency='usd'){return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(n/100);}
function terms(revision){return {en:{id:revision.id,variant:'campaign',language:'en',version:revision.version,title:revision.config.termsTitle,content:revision.config.termsContent,approved_at:revision.created_at}};}
module.exports={config,publishable,available,addMonths,money,idOf,isCampaign,terms,EMAILS};
