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
  const c = COPY[language] || COPY.en;
  const [title, body, button] = c[kind];
  const category =
    client.category === "strategic"
      ? "Strategic Partner"
      : client.offer === "founding"
        ? "Founding Partner"
        : "Partner";
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((client.amount_cents || 0) / 100);
  const details =
    kind === "staff"
      ? ""
      : `<p>${escape(c.business)}: <strong>${escape(client.business_name)}</strong><br>${escape(c.category)}: <strong style="color:#FDDD56">${category}</strong>${kind === "payment" ? `<br>${escape(c.amount)}: <strong>${amount}</strong>` : ""}</p>`;
  const previewHtml = preview
    ? `<div style="border:1px solid #333;border-radius:12px;padding:16px">${/^https:\/\//.test(preview.image_url || "") ? `<img src="${escape(preview.image_url)}" alt="${escape(preview.title)}" width="480" style="width:100%;height:auto">` : ""}<h2>${escape(preview.title)}</h2><p>${escape(preview.member_benefit || "")}</p><p>${escape(preview.location || "")}</p></div>`
    : "";
  const contact = owner.email
    ? `<p style="color:#ccc;font-size:14px">${escape(c.contact)}<br><strong>${escape(owner.name || owner.email)}</strong><br><a style="color:#FDDD56" href="mailto:${escape(owner.email)}">${escape(owner.email)}</a>${owner.phone ? `<br>${escape(owner.phone)}` : ""}</p>`
    : "";
  const extra = kind === "payment" ? `${c.period} ${c.terms}` : c.help;
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#080808;margin:0;padding:24px 10px;color:#fff;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" style="table-layout:fixed"><tr><td align="center"><table role="presentation" width="600" style="width:100%;max-width:600px;table-layout:fixed;background:#0A0A0A;border:1px solid #333" cellpadding="0" cellspacing="0"><tr><td style="text-align:center;padding:28px;font-size:36px;font-weight:800;color:white">ITC <span style="color:#FDDD56">CLUB</span></td></tr><tr><td><img src="${BASE()}/email-assets/new-york.jpg" width="600" alt="New York" style="width:100%;height:auto;display:block"></td></tr><tr><td style="padding:24px;overflow-wrap:break-word"><h1 style="font-size:28px;color:white">${escape(title)}</h1><p style="font-size:16px;line-height:1.6;color:#ddd">${escape(body)}</p>${details}${note ? `<p style="white-space:pre-wrap;color:#ddd">${escape(note)}</p>` : ""}${previewHtml}<table role="presentation" align="center" style="margin:24px auto"><tr><td bgcolor="#FDDD56" style="border-radius:10px"><a href="${escape(url)}" style="display:inline-block;padding:18px 28px;color:#0A0A0A;font-weight:800;text-decoration:none">${escape(button)}</a></td></tr></table><p style="font-size:14px;line-height:1.6;color:#ccc">${escape(extra)}</p><hr style="border:0;border-top:1px solid #333">${contact}<p style="font-size:13px;color:#aaa">ITC CLUB · Insight The City<br>noreply@insightthecity.com</p></td></tr></table></td></tr></table></body></html>`;
  return {
    from: "ITC CLUB <noreply@insightthecity.com>",
    subject: `${title} · ITC CLUB`,
    html,
    text: [
      title,
      body,
      client.business_name,
      category,
      kind === "payment" ? amount : "",
      note,
      url,
      extra,
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
  const message = render(kind, data);
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
