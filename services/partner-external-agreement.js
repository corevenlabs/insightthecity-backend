const agreements = require('../config/partner-external-agreements.json');
function agreement(row) {
  if (row.category !== 'strategic' || row.offer !== 'strategic' || row.amount_cents !== 0) return null;
  return agreements.find(item => item.clientId === row.id && item.invitationVersion === row.link_version && item.businessName === row.business_name) || null;
}
function presentation(row) {
  const value = agreement(row);
  return value ? { agreement_mode: 'external', external_agreement_reference: value.reference } : {};
}
async function confirm(c, row, name, paymentLinkReference) {
  const value = agreement(row);
  if (!value) throw new Error('External agreement not configured');
  const note = JSON.stringify({ agreementReference: value.reference, invitationVersion: row.link_version, paymentLinkReference, confirmedBy: name });
  await c.query(`INSERT INTO partner_activity(client_id,actor_id,kind,note)
    SELECT $1,NULL,'external-agreement-confirmed',$2 WHERE NOT EXISTS
    (SELECT 1 FROM partner_activity WHERE client_id=$1 AND kind='external-agreement-confirmed' AND note=$2)`, [row.id, note]);
}
async function confirmation(c, row, paymentLinkReference) {
  const value = agreement(row);
  if (!value) return false;
  const { rows } = await c.query("SELECT note FROM partner_activity WHERE client_id=$1 AND kind='external-agreement-confirmed'", [row.id]);
  return rows.some(record => {
    try {
      const note = JSON.parse(record.note);
      return note.paymentLinkReference === paymentLinkReference && note.invitationVersion === row.link_version &&
        note.agreementReference === value.reference && typeof note.confirmedBy === 'string' && Boolean(note.confirmedBy.trim());
    } catch { return false; }
  });
}
function submissionDocument(row, language, authorization) {
  const value = agreement(row);
  return {
    ...(value ? { type: 'material-authorization', title: 'Authorization to feature this business',
      agreementSource: 'external-reported-by-itc', externalAgreementReference: value.reference,
      invitationVersion: row.link_version } : row.terms_snapshot.en),
    materialAuthorizationLanguage: language, materialAuthorization: authorization,
  };
}
module.exports = { agreement, presentation, confirm, confirmation, submissionDocument };
