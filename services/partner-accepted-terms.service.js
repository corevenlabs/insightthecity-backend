const { partnerContact } = require('./partner-contact.service');
const jwt = require("jsonwebtoken");
const PDF = require("pdfkit");
const { escape } = require("./membership-email.service");
const db = require("../config/db");
const R = require("./partner-rules");
const BASE = () => (process.env.PUBLIC_BASE_URL || "https://itc-backend-1031252664334.us-east1.run.app").replace(/\/$/, "");
function date(value) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(value));
}
function url(acceptance) {
  const token = jwt.sign({ type: "partner_accepted_terms", id: acceptance.id, clientId: acceptance.client_id }, process.env.JWT_SECRET, { algorithm: "HS256", noTimestamp: true });
  return `${BASE()}/api/partners/accepted-terms?token=${encodeURIComponent(token)}`;
}
function filename(a) { return `ITC-CLUB-Participation-Terms-V${a.document.version}-${a.id}.pdf`; }
function pdf(a, client) {
  return new Promise((resolve, reject) => {
    const doc = new PDF({ size: "LETTER", margin: 48, info: { Title: a.document.title, Author: "ITC CLUB" } });
    const chunks = [];
    doc.on("data", b => chunks.push(b)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.font("Helvetica-Bold").fontSize(20).text("ITC CLUB");
    doc.moveDown(0.5).fontSize(16).text(a.document.title);
    doc.moveDown().font("Helvetica").fontSize(10);
    for (const [label, value] of [["Business", client.business_name], ["Accepted by", a.signer_name], ["Email", a.signer_email], ["Terms version", `V${a.document.version} - English`], ["Accepted at", date(a.accepted_at)], ["Time zone", "America/New_York"], ["Acceptance reference", a.id]]) doc.text(`${label}: ${value}`).moveDown(0.3);
    doc.moveDown().font("Helvetica-Bold").text("Exact accepted document");
    doc.moveDown(0.6).font("Helvetica").fontSize(10);
    for (const paragraph of a.document.content.split(/\n\s*\n/)) {
      const height = doc.heightOfString(paragraph, {lineGap: 3});
      if (height < doc.page.height - 96 && doc.y + height > doc.page.height - 48) doc.addPage();
      doc.text(paragraph, {lineGap: 3}).moveDown(0.6);
    }
    doc.end();
  });
}
function render({ client, owner = {}, acceptance: a }) {
  owner = partnerContact(owner);
  const first = client.contact_name?.trim().split(/\s+/)[0] || "there";
  const partnership = client.offer === "strategic" ? "Strategic Founding Partner" : client.offer === "founding" ? "Founding Partner" : "Partner";
  const title = "Your accepted terms, for your records.";
  const body = `Thank you for accepting the Participation Terms and Conditions for ${client.business_name}. We have attached a copy of the exact version you accepted for your records.`;
  const next = client.offer === "strategic" ? "Your participation confirmation and next steps will arrive in a separate email once your onboarding is completed." : "Accepting the terms does not confirm payment. Your participation confirmation and next steps will arrive in a separate email once your checkout is completed.";
  const items = [["Business", client.business_name], ["Partnership", partnership], ["Accepted by", a.signer_name], ["Terms version", `V${a.document.version} · English`], ["Acceptance date", date(a.accepted_at)], ["Time zone", "America/New_York"]];
  const rows = items.map(([k,v]) => `<tr><td style="padding:9px;color:#aaa;border-bottom:1px solid #333">${escape(k)}</td><td style="padding:9px;color:#fff;border-bottom:1px solid #333;overflow-wrap:anywhere">${escape(v)}</td></tr>`).join("");
  const target = url(a);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px 10px;background:#080808;color:#fff;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#0A0A0A;border:1px solid #333;table-layout:fixed"><tr><td style="padding:28px;text-align:center"><img src="${BASE()}/email-assets/itc-club-logo-v1.png" width="180" alt="ITC CLUB" style="display:block;margin:auto;width:180px;height:auto"></td></tr><tr><td><img src="${BASE()}/email-assets/partner-accepted-terms-banner-v2.png" width="600" alt="Your accepted terms. For your records." style="display:block;width:100%;height:auto"></td></tr><tr><td style="padding:24px;overflow-wrap:break-word"><h1 style="font-size:28px">${title}</h1><p style="font-size:16px;line-height:1.6">Hi ${escape(first)},</p><p style="font-size:16px;line-height:1.6;color:#ddd">${escape(body)}</p><table role="presentation" width="100%" cellspacing="0" style="background:#151515;border:1px solid #333;border-radius:12px;font-size:14px">${rows}</table><table role="presentation" align="center" style="margin:24px auto"><tr><td bgcolor="#FDDD56" style="border-radius:10px"><a href="${escape(target)}" style="display:inline-block;padding:18px 28px;color:#0A0A0A;font-weight:800;text-decoration:none">View my accepted terms</a></td></tr></table><p style="font-size:14px;color:#aaa">Attached: Participation Terms and Conditions · V${escape(String(a.document.version))}.pdf</p><p style="font-size:14px;line-height:1.6;color:#ccc">${escape(next)}</p><hr style="border:0;border-top:1px solid #333"><h2 style="font-size:20px">Need a hand?</h2><p style="color:#ccc">Your account executive is here to help.</p><p style="font-size:14px;line-height:1.6;color:#ccc">${escape(owner.name || owner.email || "ITC CLUB team")}<br>Insight The City | ITC CLUB${owner.email ? `<br><a href="mailto:${escape(owner.email)}" style="color:#FDDD56">${escape(owner.email)}</a>` : ""}</p><p style="font-size:13px;color:#aaa">Keep this email and the attached document for your records. Please keep the document link private.</p></td></tr></table></td></tr></table></body></html>`;
  return { from: "ITC CLUB <noreply@insightthecity.com>", subject: `${client.business_name} · Your Participation Terms and Conditions`, html, text: [title, `Hi ${first},`, body, ...items.map(([k,v])=>`${k}: ${v}`), "View my accepted terms", target, "A copy of your accepted agreement is attached as a PDF.", next, "Need a hand?", owner.name, owner.email, "Keep this email and the attached document for your records. Please keep the document link private."].filter(Boolean).join("\n\n"), ...(owner.email ? {replyTo: owner.email} : {}) };
}
async function download(token) {
  let claims;
  try { claims = jwt.verify(token || "", process.env.JWT_SECRET, {algorithms: ["HS256"]}); } catch { R.fail("Documento no disponible", 401); }
  if (claims.type !== "partner_accepted_terms" || !/^[a-f0-9-]{36}$/.test(claims.id || "") || !/^[a-f0-9-]{36}$/.test(claims.clientId || "")) R.fail("Documento no disponible", 401);
  const a = (await db.query("SELECT * FROM partner_acceptances WHERE id=$1 AND client_id=$2 AND stage='commercial'", [claims.id, claims.clientId])).rows[0];
  if (!a) R.fail("Documento no encontrado", 404);
  // Business name is pinned at acceptance, rather than read from editable client data.
  const client = {business_name: a.document.acceptedBusinessName};
  return {bytes: await pdf(a, client), filename: filename(a)};
}
module.exports = {date, url, filename, pdf, render, download};
