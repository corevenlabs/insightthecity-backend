const {escape}=require('./membership-email.service');
const copy={
 es:['Eliminación de cuenta completada','Tu cuenta de ITC Club y los datos vinculados de tu perfil, mensajes del chat y fotos de perfil se han eliminado. Se ha cancelado cualquier suscripción de Stripe vinculada.','Stripe puede conservar registros de pagos por obligaciones legales. Esta confirmación no implica la eliminación de respaldos de proveedores ni de registros que deban conservarse legalmente.'],
 en:['Account deletion completed','Your ITC Club account and associated profile data, chat messages and profile photos have been deleted. Any linked Stripe subscription has been canceled.','Stripe may retain payment records for legal obligations. This confirmation does not mean provider backups or legally retained records have been erased.'],
 pt:['Exclusão de conta concluída','Sua conta do ITC Club e os dados vinculados do perfil, mensagens do chat e fotos de perfil foram excluídos. Qualquer assinatura vinculada do Stripe foi cancelada.','O Stripe pode manter registros de pagamentos por obrigações legais. Esta confirmação não significa a exclusão de backups de provedores ou registros que devam ser mantidos legalmente.']
};
function render(language){
 const [title,body,note]=copy[language]||copy.es;
 const base=(process.env.PUBLIC_BASE_URL||'https://itc-backend-1031252664334.us-east1.run.app').replace(/\/$/,'');
 return {subject:`${title} · ITC Club`,text:[title,body,note,'ITC Club · Insight The City'].join('\n\n'),html:`<!doctype html><html><body style="margin:0;background:#080808;color:#fff;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="600" style="width:100%;max-width:600px;border:1px solid #333"><tr><td style="padding:30px;text-align:center"><img src="${escape(base)}/email-assets/itc-club-logo-v1.png" width="150" alt="ITC CLUB"></td></tr><tr><td style="padding:28px"><h1 style="color:#FDDD56;font-size:26px">${escape(title)}</h1><p style="line-height:1.6">${escape(body)}</p><p style="color:#ccc;font-size:14px;line-height:1.6">${escape(note)}</p><hr style="border:0;border-top:1px solid #333"><p style="color:#aaa;font-size:13px">ITC Club · Insight The City</p></td></tr></table></td></tr></table></body></html>`};
}
module.exports={render};
