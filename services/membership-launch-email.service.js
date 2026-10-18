// Approved Spanish launch emails. Banner lettering is rasterized to preserve the
// approved condensed typeface in Outlook/Gmail; body typography stays Arial.
function render({kind,user,token,date,price,base,escape:e}) {
 const account=kind==='account';
 const subject=account?'¡Ya tienes tu cuenta! Activa tu mes gratis de ITC Club':'¡Tu mes gratis ya está activo! Nos vemos en la app 🗽';
 const paragraph=text=>`<p style="font-size:16px;line-height:1.65;color:#ddd;margin:0 0 24px">${text}</p>`;
 const action=`${base}/membership-invitation#${token||''}`;
 const button=account?`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:30px 0"><tr><td bgcolor="#FDDD56" align="center" style="border-radius:10px"><a href="${e(action)}" style="display:block;padding:19px 14px;font-family:Arial,Helvetica,sans-serif;color:#0a0a0a;text-decoration:none;font-weight:700;font-size:17px">Activar mi mes gratis</a></td></tr></table>`:`<table role="presentation" align="center" width="100%" cellspacing="0" cellpadding="0" style="margin:28px 0;table-layout:fixed"><tr><td align="center" width="45%"><a href="${base}/app/download?platform=ios"><img src="${base}/email-assets/app-store-es-v1.png" width="205" alt="Descargar para iPhone en App Store" style="display:block;width:100%;max-width:205px;height:auto;border:0"></a></td><td width="3%"></td><td align="center" width="52%"><a href="${base}/app/download?platform=android"><img src="${base}/email-assets/google-play-es-v1.png" width="259" alt="Descargar para Android en Google Play" style="display:block;width:100%;max-width:259px;height:auto;border:0"></a></td></tr></table>`;
 const intro=account?[
 'Tu cuenta de Insight The City ya está lista. ¡Qué bueno tenerte por aquí! 💛',
 'Ahora vamos por ese mes gratis de ITC Club que te prometimos.',
 'Solo falta completar la activación registrando tu tarjeta. <strong style="color:#fff">Sin cargo hoy: tu mes gratis empieza cuando completes este paso.</strong>'
 ]:[
 'Tu mes gratis de ITC Club ya está activo. ¡Ahora sí, a disfrutarlo! 💛',
 'Gracias por acompañarnos desde el principio. Nos alegra que seas de las primeras personas en estrenar todo lo que hemos estado preparando.',
 'Descarga la app gratuita de Insight The City e inicia sesión con el correo y la contraseña que acabas de elegir. Tu membresía ya estará activa para que empieces a aprovechar los beneficios.'
 ];
 const after=account?[
 'Al terminar, encontrarás los enlaces para descargar la app de Insight The City. Podrás entrar con el correo y la contraseña que acabas de elegir, con tus beneficios listos para usar.',
 'Después de tu mes gratis, la membresía se renovará automáticamente por <strong style="color:#fff">US$4.99 al mes.</strong> Si prefieres no continuar, puedes cancelar desde <strong style="color:#fff">Perfil &gt; Mi membresía</strong> antes del primer cobro.'
 ]:[
 '¿Ese restaurante que tenías pendiente? ¿La experiencia que mandaste al grupo? Entra, descubre los beneficios disponibles y vamos poniéndole fecha al próximo plan. 😉',
 `Tu mes gratis termina el <strong style="color:#fff">${e(date)}</strong>. ${user.subscription_cancel_at_period_end?'Tu renovación está cancelada y no se realizará el primer cobro.':`El primer cobro será de <strong style="color:#fff">${e(price)} el ${e(date)}</strong> y, después, la membresía se renovará automáticamente cada mes.`}`,
 'Puedes cancelar desde <strong style="color:#fff">Perfil &gt; Mi membresía</strong> antes del primer cobro. Si cancelas, conservarás tus beneficios hasta que termine tu período gratuito.'
 ];
 const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head><body style="margin:0;padding:24px 10px;background:#080808;color:#fff;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;table-layout:fixed;background:#0a0a0a;border:1px solid #303030"><tr><td align="center" style="padding:28px"><img src="${base}/email-assets/itc-club-logo-v1.png" width="150" alt="ITC Club" style="display:block;width:150px;max-width:100%;height:auto;border:0"></td></tr><tr><td><img src="${base}/email-assets/${account?'membership-account-created-es-v1.png':'membership-trial-active-es-v1.png'}" width="600" alt="${account?'YA TIENES TU CUENTA':'YA ERES PARTE DEL CLUB'}" style="display:block;width:100%;height:auto;border:0"></td></tr><tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;overflow-wrap:break-word">${paragraph(`¡Hola${user.name?`, <strong style="color:#FDDD56">${e(user.name)}</strong>`:''}!`)}${intro.map(paragraph).join('')}${button}${after.map(paragraph).join('')}${paragraph('Nos vemos por la ciudad,<br><strong style="color:#fff">El equipo de ITC 💛</strong>')}<hr style="border:0;border-top:1px solid #333;margin:30px 0 20px"><p style="color:#999;font-size:12px;line-height:1.8;text-align:center">ITC CLUB · Insight The City<br><a style="color:#aaa" href="${base}/legal/subscription?lang=es">Términos de membresía</a> · <a style="color:#aaa" href="${base}/legal/privacy?lang=es">Privacidad</a> · <a style="color:#aaa" href="mailto:ITCClub@insightthecity.com">Ayuda</a></p></td></tr></table></td></tr></table></body></html>`;
 const text=[subject,`¡Hola${user.name?', '+user.name:''}!`,...intro,account?`Activar mi mes gratis: ${action}`:`Descargar para iPhone: ${base}/app/download?platform=ios\nDescargar para Android: ${base}/app/download?platform=android`,...after,'Nos vemos por la ciudad,\nEl equipo de ITC 💛'].join('\n\n').replace(/<[^>]*>/g,'').replace(/&gt;/g,'>');
 return {subject,html,text};
}
async function sendAccountCreated(user,token){
 const mailer=require('./password-reset-mail.service');if(!mailer.isConfigured())return;
 const db=require('../config/db'),common=require('./membership-email.service');
 const claim=await db.query('UPDATE membership_launch_invitations SET account_email_sent_at=NOW() WHERE user_id=$1 AND activated_at IS NULL AND account_email_sent_at IS NULL RETURNING id',[user.id]);
 if(!claim.rowCount)return;
 try{await mailer.send({to:user.email,...render({kind:'account',user,token,base:common.baseUrl(),escape:common.escape})});}
 catch(error){await db.query('UPDATE membership_launch_invitations SET account_email_sent_at=NULL WHERE id=$1',[claim.rows[0].id]);throw error;}
}
module.exports={render,sendAccountCreated};
