require('dotenv').config({quiet:true});
const db=require('../config/db'),launch=require('../services/membership-launch.service'),mailer=require('../services/password-reset-mail.service');
(async()=>{
 if(!launch.enabled())throw Error('Launch sandbox disabled');
 const email='rmj.rafael@gmail.com';
 if(!mailer.isConfigured())throw Error('Email transport not configured');
 const existing=(await db.query('SELECT stripe_subscription_id,is_premium FROM users WHERE LOWER(email)=$1',[email])).rows[0];
 if(existing?.stripe_subscription_id || existing?.is_premium)throw Error('Test account already has membership. Use an account without a prior subscription.');
 const invite=await launch.issue(email),base='https://itc-backend-1031252664334.us-east1.run.app';
 const url=base+'/membership-invitation#'+invite.token;
 const c=require('../services/membership-email.service'),message=require('../services/membership-welcome-email.service').render({lang:'es',c:{...c.COPY.es,price:'Después de los 30 días gratis',next:'Primer cargo',unknown:''},greeting:'Tu invitación personal a ITC Club',date:'Stripe mostrará la fecha al activar',price:'US$4.99 al mes',note:'PRUEBA EN SANDBOX · SIN COBROS REALES. Inicia sesión con tu cuenta de la app y este mismo correo. Se requiere tarjeta de prueba y aceptación de la renovación. Cancela en Perfil > Mi membresía antes del primer cargo para evitarlo. La invitación es individual y vence en 30 días.',base,url,escape:c.escape});
 message.subject='Prueba · Tu invitación a 30 días gratis de ITC Club';
 message.html=message.html.replace('Explorar mis beneficios','Activar mis 30 días gratis').replace('Tu membresía de ITC Club ya está activa','Tu invitación a 30 días gratis está lista').replace('y tus beneficios están listos para acompañarte en tu próximo plan.','Actívala para comenzar tu período de prueba.').replace('Entra a la app, explora los lugares y experiencias del Club y elige por dónde empezar. En cada beneficio encontrarás cómo usarlo y sus condiciones.','Abre el botón de esta invitación, inicia sesión con tu cuenta de la app y completa el checkout seguro de Stripe. Todavía no se ha activado la membresía.');
 message.text='Invitación de prueba: 30 días gratis, luego US$4.99 mensuales con renovación automática. Tarjeta de prueba obligatoria. Sin cobros reales. Cancela antes del primer cargo en Perfil > Mi membresía. Crea tu cuenta en la app con el mismo correo si aún no tienes una.\n'+url;
 await mailer.send({to:email,...message});
 console.log('Individual test invitation delivered; private URL omitted.');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());
