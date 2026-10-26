const { layout, paragraph, panel } = require('./email-layout');
const COPY = {
  es: { title:'Tu contraseña fue actualizada', intro:'La contraseña de tu cuenta de ITC Club se actualizó correctamente.', access:'Ya puedes iniciar sesión con tu nueva contraseña.', security:'Si no realizaste este cambio, contacta de inmediato al equipo de ITC Club.', label:'CAMBIO CONFIRMADO', help:'¿Necesitas ayuda?', support:'Contactar a ITC Club' },
  en: { title:'Your password was updated', intro:'Your ITC Club account password was updated successfully.', access:'You can now sign in with your new password.', security:'If you did not make this change, contact the ITC Club team immediately.', label:'CHANGE CONFIRMED', help:'Need a hand?', support:'Contact ITC Club' },
  pt: { title:'Sua senha foi atualizada', intro:'A senha da sua conta do ITC Club foi atualizada com sucesso.', access:'Agora você pode entrar com sua nova senha.', security:'Se você não fez esta alteração, entre em contato com a equipe do ITC Club imediatamente.', label:'ALTERAÇÃO CONFIRMADA', help:'Precisa de ajuda?', support:'Contatar ITC Club' },
};
function render(language) {
  const lang = Object.hasOwn(COPY, language) ? language : 'es', c = COPY[lang];
  return { subject:`ITC Club · ${c.title}`, text:[c.intro,c.access,c.security,'ITCClub@insightthecity.com'].join('\n\n'),
    html:layout({lang,title:c.title,content:paragraph(c.intro)+panel(`<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#FDDD56">${c.label}</p>`+paragraph(c.access))+paragraph(c.security),help:c.help,supportLabel:c.support}) };
}
module.exports = { render };
