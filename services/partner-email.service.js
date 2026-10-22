const { partnerContact } = require('./partner-contact.service');
const db = require("../config/db");
const mail = require("./password-reset-mail.service");
const { escape } = require("./membership-email.service");
const PANEL = () =>
  (
    process.env.PANEL_PUBLIC_URL ||
    "https://itc-panel-1031252664334.us-east1.run.app"
  ).replace(/\/$/, "");
const BASE = () =>
  (
    process.env.PUBLIC_BASE_URL ||
    "https://itc-backend-1031252664334.us-east1.run.app"
  ).replace(/\/$/, "");
const COPY = {
  en: {
    approval: ["Business profile pending approval", "The account manager has finished reviewing this profile. Administrator approval and activation are required before the profile is available in the app.", "Review and approve profile"],
    payment: [
      "Your business, in ITC CLUB",
      "Review your agreement and complete the payment to receive your private information form.",
      "Review and pay",
    ],
    invite: [
      "Let’s prepare your business profile",
      "Your private form is ready. Add your business details, benefit, logo and photos. You can save your progress and continue later.",
      "Complete information",
    ],
    received: [
      "Welcome to ITC CLUB",
      "We received your information. Our team will review it and prepare your profile. We will contact you if anything is missing and let you know when your business is available in the app.",
      "View your submission",
    ],
    changes: [
      "Please update your information",
      "Our team needs a few updates before preparing your profile.",
      "Update information",
    ],
    published: [
      "Your business is now on ITC CLUB",
      "Your business profile is available in the app. Here is a preview of your listing.",
      "View in the app",
    ],
    executive: [
      "Client information received",
      "Your assigned client submitted their information. Open the record to review the material and continue the process.",
      "Open client record",
    ],
    staff: [
      "You’re invited to the ITC CLUB team",
      "Set your password to access the administration panel. This invitation expires in 48 hours.",
      "Set password",
    ],
    contact: "Your contact at ITC CLUB",
    business: "Business",
    category: "Category",
    amount: "Amount",
    period:
      "Initial period: six months from manual activation. Renewal will be agreed separately.",
    terms: "Review the applicable terms before payment.",
    help: "Questions? Contact your assigned executive.",
  },
  es: {
    approval: ["Perfil pendiente de aprobación", "El ejecutivo terminó de revisar este perfil. Un administrador debe aprobarlo y activarlo antes de que esté disponible en la app.", "Revisar y aprobar perfil"],
    payment: [
      "Tu negocio, en ITC CLUB",
      "Revisa el acuerdo y completa el pago para recibir tu formulario privado.",
      "Revisar y pagar",
    ],
    invite: [
      "Preparemos la ficha de tu negocio",
      "Tu formulario privado está disponible. Completa los datos, beneficio, logo y fotografías. Puedes guardar y continuar después.",
      "Completar información",
    ],
    received: [
      "Bienvenido a ITC CLUB",
      "Recibimos tu información. Nuestro equipo revisará el material y preparará tu ficha. Te contactaremos si falta algo y te avisaremos cuando tu negocio esté disponible en la app.",
      "Ver información enviada",
    ],
    changes: [
      "Necesitamos actualizar tu información",
      "Nuestro equipo necesita algunos ajustes antes de preparar tu ficha.",
      "Actualizar información",
    ],
    published: [
      "Tu negocio ya está en ITC CLUB",
      "Tu ficha está disponible en la app. Aquí tienes una vista previa de tu publicación.",
      "Ver en la app",
    ],
    executive: [
      "Información de cliente recibida",
      "Tu cliente asignado envió su información. Abre su ficha para revisar el material y continuar la gestión.",
      "Ver ficha del cliente",
    ],
    staff: [
      "Te invitamos al equipo de ITC CLUB",
      "Establece tu contraseña para entrar al panel. La invitación vence en 48 horas.",
      "Establecer contraseña",
    ],
    contact: "Tu contacto en ITC CLUB",
    business: "Negocio",
    category: "Categoría",
    amount: "Importe",
    period:
      "Período inicial: seis meses desde la activación manual. La renovación se acordará por separado.",
    terms: "Revisa los términos aplicables antes de pagar.",
    help: "¿Tienes dudas? Contacta a tu ejecutivo.",
  },
  pt: {
    approval: ["Perfil pendente de aprovação", "O executivo terminou a revisão deste perfil. Um administrador deve aprovar e ativar o perfil antes de disponibilizá-lo no aplicativo.", "Revisar e aprovar perfil"],
    payment: [
      "Seu negócio no ITC CLUB",
      "Revise o acordo e conclua o pagamento para receber seu formulário privado.",
      "Revisar e pagar",
    ],
    invite: [
      "Vamos preparar o perfil do seu negócio",
      "Seu formulário está disponível. Adicione dados, benefício, logo e fotografias. Você pode salvar e continuar depois.",
      "Completar informações",
    ],
    received: [
      "Bem-vindo ao ITC CLUB",
      "Recebemos suas informações. Nossa equipe revisará o material e preparará seu perfil. Entraremos em contato se faltar algo e avisaremos quando estiver disponível no app.",
      "Ver informações enviadas",
    ],
    changes: [
      "Precisamos atualizar suas informações",
      "Precisamos de alguns ajustes antes de preparar seu perfil.",
      "Atualizar informações",
    ],
    published: [
      "Seu negócio já está no ITC CLUB",
      "Seu perfil está disponível no app. Veja uma prévia da publicação.",
      "Ver no app",
    ],
    executive: [
      "Informações do cliente recebidas",
      "Seu cliente enviou suas informações. Abra a ficha para revisar o material e continuar o atendimento.",
      "Abrir ficha do cliente",
    ],
    staff: [
      "Convite para a equipe ITC CLUB",
      "Defina sua senha para acessar o painel. Este convite expira em 48 horas.",
      "Definir senha",
    ],
    contact: "Seu contato no ITC CLUB",
    business: "Negócio",
    category: "Categoria",
    amount: "Valor",
    period:
      "Período inicial: seis meses a partir da ativação manual. A renovação será acordada separadamente.",
    terms: "Revise os termos aplicáveis antes de pagar.",
    help: "Dúvidas? Entre em contato com seu executivo.",
  },
};
function render(
  kind,
  { client = {}, owner = {}, url, note = "", preview, language = "en" },
) {
  owner = partnerContact(owner);
  const strategic = client.offer === "strategic";
  const partnership = strategic ? "Strategic Founding Partner" : "Founding Partner";
  const foundingInvitation = kind === "payment" && ["founding", "strategic"].includes(client.offer);
  const foundingWelcome = kind === "invite" && ["founding", "strategic"].includes(client.offer);
  const corrections = kind === "changes";
  const received = kind === "received";
  if (foundingInvitation || foundingWelcome || corrections || received) language = "en";
  const c = COPY[language] || COPY.en;
  let [title, body, button] = c[kind];
  const firstName = (client.contact_name || "").trim().split(/\s+/)[0] || "there";
  if (foundingInvitation) {
    title = "Let’s grow together.";
    body = `Hi ${firstName},\n\nWe’re excited to invite ${client.business_name} to join ITC CLUB as a ${partnership}.\n\nTogether, we can give our community more reasons to discover your business, visit, and come back. We’ll work with you to shape an exclusive member benefit that fits your business and creates value for both sides.`;
    button = "Confirm your participation";
  }
  if (foundingWelcome) {
    title = "Welcome to ITC CLUB. Let’s build this together.";
    body = `Hi ${firstName},\n\nYour participation is confirmed! We’re excited to welcome ${client.business_name} as a ${partnership}. Thank you for helping us build ITC CLUB from the start.\n\nNow, let’s get your business ready for our community to discover.\n\nShare your business details, member benefit, logo, and photos through the form below. These will help us create a profile that reflects what makes your business special.`;
    button = "Create my business profile";
  }
  if (corrections) {
    title = "Let’s show what makes your business special.";
    body = `Hi ${firstName},\n\nThanks for sharing your business details and photos with us. We’ve reviewed ${client.business_name}’s profile and have a few suggestions to help it make a great first impression with our community.`;
    button = "Update my business profile";
  }
  if (received) {
    title = `Welcome aboard, ${client.business_name}!`;
    body = "We’re excited to have you join ITC Club. Together, we’re giving our community more reasons to explore, discover, and enjoy New York and New Jersey—with businesses like yours along the way.\n\nYour profile is in our hands.\n\nWe’ve received your submission. Your account manager will review your business details and member benefit, then prepare your profile for the app. They’ll reach out if anything else is needed and let you know when your profile is live.";
    button = "View your submission";
  }
  const titleHtml = received ? `Welcome aboard, <span style="color:#FDDD56">${escape(client.business_name)}!</span>` : escape(title);
  const bodyHtml = body.split("\n\n").map(p => received && p === "Your profile is in our hands." ? `<h2 style="font-size:20px;color:white">${escape(p)}</h2>` : `<p style="font-size:16px;line-height:1.6;color:#ddd">${escape(p)}</p>`).join("");
  const category =
    client.category === "strategic"
      ? "Strategic Founding Partner"
      : client.offer === "founding"
        ? "Founding Partner"
        : "Partner";
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((client.amount_cents || 0) / 100);
  const taxNotice = client.offer === "founding" && !require("./partner-payment-link.service").testMode() && require("./partner-payment-link.service").configured() ? " Applicable taxes are calculated by Stripe and added at checkout. You’ll see the final total before confirming payment." : "";
  const investment = `Total investment: ${amount.replace(/\.00$/, "")} for six months, starting when your profile is activated.${taxNotice}`;
  const covered = "Your participation is fully covered for six months, starting when your profile is activated. No payment is required.";
  const strategicInvestment = "Regular participation fee: $1,800\nYour invitation includes 100% OFF\nYour total: $0\n" + covered;
  const invitationPricing = strategic
    ? `Regular participation fee: <s style="color:#aaa">$1,800</s><br>Your invitation includes <strong style="color:#FDDD56">100% OFF</strong><br>Your total: <strong>$0</strong><br>${escape(covered)}`
    : escape(investment);
  const details = received
    ? `<div style="border:1px solid #333;border-radius:12px;padding:18px"><p style="color:#ddd;line-height:1.6;margin:0">Business: <strong>${escape(client.business_name)}</strong><br>Partner type: <strong style="color:#FDDD56">${escape(category)}</strong></p></div>`
    : foundingInvitation
    ? `<p>Business: <strong>${escape(client.business_name)}</strong><br>Partnership: <strong style="color:#FDDD56">${partnership}</strong><br>${invitationPricing}</p>`
    : kind === "staff" || foundingWelcome || corrections
      ? ""
      : `<p>${escape(c.business)}: <strong>${escape(client.business_name)}</strong><br>${escape(c.category)}: <strong style="color:#FDDD56">${category}</strong>${kind === "payment" ? `<br>${escape(c.amount)}: <strong>${amount}</strong>` : ""}</p>`;
  const previewHtml = preview
    ? `<div style="border:1px solid #333;border-radius:12px;padding:16px">${/^https:\/\//.test(preview.image_url || "") ? `<img src="${escape(preview.image_url)}" alt="${escape(preview.title)}" width="480" style="width:100%;height:auto">` : ""}<h2>${escape(preview.title)}</h2><p>${escape(preview.member_benefit || "")}</p><p>${escape(preview.location || "")}</p></div>`
    : "";
  const privateNotice = "This link is unique to your business. Please keep it private.";
  const helpText = corrections
    ? "If you have questions about the suggestions or need help with your photos, reach out. I’m here to help."
    : "If you have questions about the form or want to discuss your member benefit, reach out. I’m here to help.";
  const contact = received
    ? `<p style="color:#ccc;font-size:14px;line-height:1.6">Your ITC Club contact${owner.name || owner.email ? `<br><strong>${escape(owner.name || owner.email)}</strong>` : ""}${owner.email ? `<br><a style="color:#FDDD56" href="mailto:${escape(owner.email)}">${escape(owner.email)}</a>` : ""}</p>`
    : foundingWelcome || corrections
    ? `<h2 style="font-size:20px;color:white">Need a hand?</h2><p style="color:#ccc;font-size:16px;line-height:1.6">${escape(helpText)}</p><p style="color:#ccc;font-size:14px;line-height:1.6">${owner.name || owner.email ? `<strong>${escape(owner.name || owner.email)}</strong><br>` : ""}Insight The City | ITC CLUB${owner.email ? `<br><a style="color:#FDDD56" href="mailto:${escape(owner.email)}">${escape(owner.email)}</a>` : ""}</p>`
    : owner.email
    ? `<p style="color:#ccc;font-size:14px">${escape(c.contact)}<br><strong>${escape(owner.name || owner.email)}</strong><br><a style="color:#FDDD56" href="mailto:${escape(owner.email)}">${escape(owner.email)}</a>${owner.phone ? `<br>${escape(owner.phone)}` : ""}</p>`
    : "";
  const extra = received
    ? "Let’s make this a great partnership.\n\nHave a question or something to add? Your account manager is here to help."
    : foundingInvitation
    ? "Once you confirm, you’ll receive a short form to share your business details. From there, we’ll work together on your profile and member benefit to get everything ready for the app.\n\nWe see this as the beginning of a partnership we can grow over time. We’re looking forward to taking this next step with you."
    : foundingWelcome
      ? "You can save your progress and come back later—you don’t need to have everything ready at once.\n\nOnce you submit the form, our team will review your information and work with you to get your profile and benefit ready for activation.\n\nWe’re looking forward to growing this partnership with you."
      : corrections
        ? "Once you’ve made the changes, send your profile back to our team through the form. We’ll review the updates and work with you to get everything ready for activation.\n\nWe’re excited to introduce your business to our community."
        : kind === "payment" ? `${c.period} ${c.terms}` : c.help;
  const invitationExtra = extra;
  const extraHtml = invitationExtra.split("\n\n").map(p => received && p === "Let’s make this a great partnership." ? `<h2 style="font-size:20px;color:white">${escape(p)}</h2>` : `<p style="font-size:14px;line-height:1.6;color:#ccc">${escape(p)}</p>`).join("");
  const brandHeader = foundingInvitation || foundingWelcome || corrections || received
    ? `<img src="${BASE()}/email-assets/itc-club-logo-v1.png" width="180" alt="ITC CLUB" style="display:block;width:180px;max-width:100%;height:auto;margin:0 auto;border:0">`
    : 'ITC <span style="color:#FDDD56">CLUB</span>';
  const banner = foundingInvitation ? "partner-invitation-banner-v2.png" : foundingWelcome || received ? "partner-welcome-banner-v2.png" : corrections ? "partner-corrections-banner-v2.png" : "new-york.jpg";
  const bannerAlt = foundingInvitation ? "Your business. Our community. Let’s grow together. An invitation to join ITC CLUB" : foundingWelcome || received ? "Welcome to ITC CLUB. Let’s build this together." : corrections ? title : "New York";
  const footer = received ? "Thank you for being part of what we’re building.<br><br>The ITC Club Team" : foundingWelcome || corrections ? privateNotice : "ITC CLUB · Insight The City<br>noreply@insightthecity.com";
  const requestHelp = "You can make these changes through your existing form. Everything you’ve already shared is saved, so you can pick up where you left off.";
  const noteHtml = corrections
    ? `<h2 style="font-size:20px;color:white">A few details to finish together</h2><div style="border:1px solid #333;border-radius:12px;padding:18px;background:#151515"><p style="white-space:pre-wrap;overflow-wrap:break-word;color:#ddd;font-size:16px;line-height:1.6;margin:0">${escape(note)}</p></div><p style="font-size:16px;line-height:1.6;color:#ddd">${requestHelp}</p>`
    : note ? `<p style="white-space:pre-wrap;color:#ddd">${escape(note)}</p>` : "";
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#080808;margin:0;padding:24px 10px;color:#fff;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" style="table-layout:fixed"><tr><td align="center"><table role="presentation" width="600" style="width:100%;max-width:600px;table-layout:fixed;background:#0A0A0A;border:1px solid #333" cellpadding="0" cellspacing="0"><tr><td style="text-align:center;padding:28px;font-size:36px;font-weight:800;color:white">${brandHeader}</td></tr><tr><td><img src="${BASE()}/email-assets/${banner}" width="600" alt="${escape(bannerAlt)}" style="width:100%;height:auto;display:block"></td></tr><tr><td style="padding:24px;overflow-wrap:break-word"><h1 style="font-size:28px;color:white">${titleHtml}</h1>${bodyHtml}${details}${noteHtml}${previewHtml}<table role="presentation" align="center" style="margin:24px auto"><tr><td bgcolor="#FDDD56" style="border-radius:10px"><a href="${escape(url)}" style="display:inline-block;padding:18px 28px;color:#0A0A0A;font-weight:800;text-decoration:none">${escape(button)}</a></td></tr></table>${extraHtml}<hr style="border:0;border-top:1px solid #333">${contact}<p style="font-size:13px;color:#aaa">${footer}</p></td></tr></table></td></tr></table></body></html>`;
  return {
    from: "ITC CLUB <noreply@insightthecity.com>",
    subject: received ? title : corrections ? `${client.business_name} · Let’s put the finishing touches on your profile` : foundingInvitation ? `${client.business_name} + ITC CLUB: Let’s grow together` : foundingWelcome ? title : `${title} · ITC CLUB`,
    html,
    text: received ? [title, body, `Business: ${client.business_name}\nPartner type: ${category}`, button, url, extra, "Your ITC Club contact", owner.name || owner.email, owner.email, "Thank you for being part of what we’re building.", "The ITC Club Team"].filter(Boolean).join("\n\n") : corrections ? [title, body, "A few details to finish together", note, requestHelp, button, url, extra, "Need a hand?", helpText, owner.name || owner.email, "Insight The City | ITC CLUB", owner.email, privateNotice].filter(Boolean).join("\n\n") : foundingWelcome ? [title, body, button, url, extra, "Need a hand?", "If you have questions about the form or want to discuss your member benefit, reach out. I’m here to help.", owner.name || owner.email, "Insight The City | ITC CLUB", owner.email, privateNotice].filter(Boolean).join("\n\n") : [
      title,
      body,
      client.business_name,
      category,
      foundingInvitation ? strategic ? strategicInvestment : investment : kind === "payment" ? amount : "",
      note,
      url,
      invitationExtra,
      owner.name,
      owner.email,
      owner.phone,
    ]
      .filter(Boolean)
      .join("\n"),
    ...(owner.email ? { replyTo: owner.email } : {}),
  };
}
async function queue(connection, { key, clientId, to, kind, data }) {
  const terms = kind === "accepted_terms" ? require("./partner-accepted-terms.service") : null;
  const message = terms ? terms.render(data) : render(kind, data);
  if (terms) message.attachments = [{ filename: terms.filename(data.acceptance), content: (await terms.pdf(data.acceptance, data.client)).toString("base64"), encoding: "base64", contentType: "application/pdf" }];
  const receipt = kind === 'invite' ? data.receipt || data.client?.stripe_payment_receipt : null;
  if (receipt) {
    const service = require('./partner-receipt.service');
    const notice = receipt.kind === 'payment' ? 'Your payment receipt is attached.' : 'Your no-cost participation confirmation is attached.';
    message.html = message.html.replace('<hr ', `<p style="font-size:14px;color:#ccc">${notice}</p><hr `);
    message.text += `\n\n${notice}`;
    message.attachments = [{ filename: service.filename(receipt), content: (await service.pdf(receipt)).toString('base64'), encoding: 'base64', contentType: 'application/pdf' }];
  }
  await connection.query(
    "INSERT INTO partner_mail(client_id,dedupe_key,recipient,message) VALUES($1,$2,$3,$4) ON CONFLICT(dedupe_key) DO NOTHING",
    [clientId || null, key, to, JSON.stringify(message)],
  );
}
async function flush(clientId) {
  if (!mail.isConfigured()) return;
  const { rows } = await db.query(
    `UPDATE partner_mail SET status='sending',locked_at=NOW(),attempts=attempts+1 WHERE id IN (SELECT id FROM partner_mail WHERE ($1::uuid IS NULL OR client_id=$1) AND (status IN ('pending','failed') OR (status='sending' AND locked_at<NOW()-INTERVAL '5 minutes')) AND attempts<8 ORDER BY created_at LIMIT 8 FOR UPDATE SKIP LOCKED) RETURNING *`,
    [clientId || null],
  );
  for (const row of rows) {
    try {
      await mail.send({ to: [row.recipient], ...row.message });
      await db.query(
        "UPDATE partner_mail SET status='sent',sent_at=NOW(),error_code=NULL WHERE id=$1",
        [row.id],
      );
    } catch (error) {
      await db.query(
        "UPDATE partner_mail SET status='failed',error_code=$2 WHERE id=$1",
        [row.id, String(error.code || "MAIL_SEND_FAILED").slice(0, 80)],
      );
    }
  }
}
module.exports = { render, queue, flush, PANEL, BASE };
