const { escape } = require('./membership-email.service');
const { layout, paragraph, panel } = require('./email-layout');
function deletionAlert(requestId, stage) {
  const subject='ITC Club · Account deletion needs attention';
  const text=`Request ${requestId} is pending at stage ${stage}. Review the protected account deletion endpoint. Automatic retries will continue.`;
  const details=panel(`<p style="margin:0 0 12px;font-size:11px;letter-spacing:1px;color:#FDDD56;font-weight:700">Pending request</p><p style="margin:0;font-size:15px;line-height:1.8;color:#ddd">Request: <strong>${escape(requestId)}</strong><br>Stage: <strong>${escape(stage)}</strong></p>`);
  return {subject,text,html:layout({lang:'en',title:'Account deletion needs attention',banner:'lifecycle-alert-en-v1.png',bannerAlt:'Review required.',content:paragraph('An account deletion request needs an administrator’s attention.')+details+paragraph('Review the protected account deletion endpoint. Automatic retries will continue.')+paragraph('Internal operational notice. Review the request through your authorized tools.'),help:'Need assistance?',supportLabel:'Contact ITC Club'})};
}
function smtpTest() {
  const subject='Prueba de correo ITC Club';
  const text='La conexión de ITC Club con SiteGround funciona. Este mensaje es una prueba y no cambia ninguna contraseña.';
  return {subject,text,html:layout({lang:'es',title:'Prueba de correo ITC Club',banner:'lifecycle-smtp-es-v1.png',bannerAlt:'Prueba de correo.',content:paragraph('La conexión de ITC Club con SiteGround funciona.')+panel('<p style="margin:0 0 12px;font-size:11px;letter-spacing:1px;color:#FDDD56;font-weight:700">Mensaje de prueba</p><p style="margin:0;font-size:15px;line-height:1.6;color:#ddd">Este mensaje es una prueba y no cambia ninguna contraseña.</p>')+paragraph('Confirma su recepción en el buzón para completar la revisión del envío.'),help:'¿Necesitas ayuda?',supportLabel:'Contactar a ITC Club'})};
}
module.exports={deletionAlert,smtpTest};
