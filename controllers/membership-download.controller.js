const {escape,baseUrl}=require('../services/membership-email.service');
function storeUrl(platform){
 const raw=platform==='ios'?process.env.APP_STORE_DOWNLOAD_URL:process.env.GOOGLE_PLAY_DOWNLOAD_URL;
 try{const u=new URL(raw);const allowed=platform==='ios'?['apps.apple.com','testflight.apple.com','expo.dev']:['play.google.com','expo.dev'];return u.protocol==='https:'&&allowed.includes(u.hostname)?u.href:null;}catch{return null;}
}
function page(res,{title='Descarga Insight The City',message='Entra con el correo y la contraseña que creaste para tu cuenta.'}={}){
 const base=baseUrl();res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');res.set('Content-Security-Policy',"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
 const badge=(platform,file,alt)=>storeUrl(platform)?`<a href="${escape(storeUrl(platform))}"><img src="${base}/email-assets/${file}" alt="${alt}"></a>`:`<div><img src="${base}/email-assets/${file}" alt="${alt}" style="opacity:.45"><p>${platform==='ios'?'iPhone':'Android'}: descarga todavía no disponible.<br>ITC compartirá el enlace cuando esté listo.</p></div>`;
 return res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · ITC Club</title><style>*{box-sizing:border-box}body{background:#080808;color:#fff;font:16px/1.6 Arial,Helvetica,sans-serif;margin:0;padding:24px}main{max-width:600px;margin:auto;border:1px solid #333;background:#0a0a0a;border-radius:16px;overflow:hidden}.brand{display:block;width:150px;height:auto;margin:28px auto}.banner{display:block;width:100%}section{padding:28px}h1{font-size:28px;line-height:1.2}p{color:#ccc}.stores{text-align:center}.stores img{width:205px;height:auto;max-width:100%}.stores div{margin:24px 0}.button{display:block;text-align:center;background:#FDDD56;color:#080808;padding:16px;border-radius:10px;font-weight:bold;text-decoration:none;margin-top:24px}a{color:#FDDD56}</style></head><body><main><img class="brand" src="${base}/email-assets/itc-club-logo-v1.png" alt="ITC Club"><img class="banner" src="${base}/email-assets/membership-trial-active-es-v2.png" alt="YA ERES PARTE DEL CLUB"><section><h1>${escape(title)}</h1><p>${escape(message)}</p><div class="stores">${badge('ios','app-store-es-v1.png','Descargar para iPhone en App Store')}${badge('android','google-play-es-v1.png','Descargar para Android en Google Play')}</div><a class="button" href="itcclub://login">Ya la instalé: abrir ITC Club</a><p>Usa tu correo y la contraseña que elegiste. Puedes consultar el período gratuito y cancelar la renovación en Perfil &gt; Mi membresía.</p><a href="mailto:ITCClub@insightthecity.com">¿Necesitas ayuda?</a></section></main></body></html>`);
}
function download(req,res){const url=storeUrl(req.query.platform);if(url){res.set('Cache-Control','no-store');return res.redirect(302,url);}return page(res);}
async function activation(req,res,next){
 try{
  const id=String(req.query.session_id||'');if(!/^cs_[A-Za-z0-9_]{8,250}$/.test(id))return res.status(400).send('Sesión inválida. Abre tu invitación original.');
  const session=await require('../services/stripe.service').retrieveCheckoutSession(id,{expand:['subscription']});
  if(session.mode!=='subscription'||session.status!=='complete'||!session.subscription?.metadata?.launch_invitation_id)return page(res,{title:'Estamos confirmando tu activación',message:'No repitas el checkout. Recibirás un correo cuando Stripe confirme tu activación.'});
  const user=await require('../services/subscription.service').confirmCheckout(session.client_reference_id,id);
  if(!user?.is_premium||user.subscription_status!=='trialing')return page(res,{title:'Consulta tu membresía en la app',message:'Entra con tu cuenta para consultar el estado actual de tu membresía.'});
  return page(res,{title:'Tu mes gratis está activo',message:'Tu activación está confirmada. Te enviaremos un correo con las fechas de tu membresía. Descarga la app cuando esté disponible e inicia sesión con la cuenta que creaste.'});
 }catch(e){next(e);}
}
module.exports={download,activation,storeUrl};
