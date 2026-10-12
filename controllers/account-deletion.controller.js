const bcrypt = require("bcryptjs");
const db = require("../config/db");
const usersService = require("../services/users.service");
const { escapeHtml } = require("../utils/legalMarkdown");

// Página pública para solicitar la eliminación de la cuenta sin instalar la app
// (requisito de Google Play: Data safety > Account deletion URL).
// Hace exactamente lo mismo que "Eliminar cuenta" en la app: bloquea la cuenta y
// encola la eliminación (Stripe, datos, fotos y correo de confirmación).

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map(); // ip -> { count, resetAt }

function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

const COPY = {
  es: {
    title: "Eliminar tu cuenta de ITC Club",
    intro: "Puedes eliminar tu cuenta de ITC Club (Insight The City) y tus datos personales en cualquier momento.",
    inApp: "Desde la app: abre <strong>Perfil &gt; Eliminar cuenta</strong>.",
    web: "Desde esta página: ingresa el correo y la contraseña de tu cuenta.",
    deleted: "Qué se elimina",
    deletedItems: [
      "Tu cuenta, nombre, correo, foto de perfil e intereses.",
      "Tus mensajes del chat y tus códigos de beneficios.",
      "Tu membresía ITC Club: se cancela de inmediato y no se te vuelve a cobrar.",
    ],
    kept: "Tu cuenta se bloquea de inmediato y la eliminación es permanente. Te enviaremos un correo cuando termine. Stripe puede conservar el registro de tus pagos por obligaciones legales y fiscales.",
    email: "Correo electrónico",
    password: "Contraseña",
    confirm: "Entiendo que mi cuenta y mis datos se eliminarán de forma permanente.",
    submit: "Eliminar mi cuenta",
    forgot: "¿Olvidaste tu contraseña? Recupérala en la app con \"Olvidé mi contraseña\" o escríbenos a",
    done: "Solicitud de eliminación recibida. Tu cuenta está bloqueada y la eliminación está en proceso. Te enviaremos un correo cuando termine. Si no recibes la confirmación en 48 horas, escríbenos.",
    invalid: "El correo o la contraseña no son correctos.",
    missing: "Completa el correo, la contraseña y la casilla de confirmación.",
    limited: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.",
    failed: "No pudimos eliminar la cuenta en este momento. Inténtalo más tarde o escríbenos a",
    other: "English",
  },
  en: {
    title: "Delete your ITC Club account",
    intro: "You can delete your ITC Club (Insight The City) account and personal data at any time.",
    inApp: "In the app: open <strong>Profile &gt; Delete account</strong>.",
    web: "On this page: enter your account email and password.",
    deleted: "What is deleted",
    deletedItems: [
      "Your account, name, email, profile photo and interests.",
      "Your chat messages and benefit codes.",
      "Your ITC Club membership: it is canceled immediately and you will not be charged again.",
    ],
    kept: "Your account is blocked immediately and deletion is permanent. We will email you when it is complete. Stripe may keep records of your payments for legal and tax obligations.",
    email: "Email",
    password: "Password",
    confirm: "I understand that my account and data will be permanently deleted.",
    submit: "Delete my account",
    forgot: "Forgot your password? Reset it in the app with \"Forgot password\" or email us at",
    done: "Deletion request received. Your account is blocked and deletion is in progress. We will email you when it is complete. If you do not receive confirmation within 48 hours, contact us.",
    invalid: "The email or password is incorrect.",
    missing: "Enter your email and password and tick the confirmation box.",
    limited: "Too many attempts. Wait 15 minutes and try again.",
    failed: "We could not delete the account right now. Try again later or email us at",
    other: "Español",
  },
};

function supportEmail() {
  return process.env.SUPPORT_EMAIL || "";
}

function render(res, { lang, status = 200, message = "", success = false }) {
  const c = COPY[lang];
  const support = supportEmail();
  const supportLink = support ? ` <a href="mailto:${escapeHtml(support)}">${escapeHtml(support)}</a>.` : ".";
  const otherLang = lang === "es" ? "en" : "es";
  res.status(status).set("Cache-Control", "no-store").type("html").send(`<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${c.title}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #050505; color: #ececec; font-family: -apple-system, "Segoe UI", Roboto, system-ui, sans-serif; line-height: 1.6; }
  main { max-width: 620px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 12px; color: #fff; }
  h2 { font-size: 18px; margin: 28px 0 8px; color: #fff; }
  a { color: #FDDD56; }
  .lang { float: right; font-size: 14px; }
  .msg { padding: 14px 16px; border-radius: 12px; margin: 18px 0; }
  .ok { background: #12301b; border: 1px solid #2e7d4a; }
  .err { background: #3a1414; border: 1px solid #a33; }
  form { margin-top: 18px; padding: 18px; border: 1px solid #333; border-radius: 16px; background: #111; }
  label { display: block; font-weight: 700; margin: 14px 0 6px; }
  input[type=email], input[type=password] { width: 100%; box-sizing: border-box; padding: 13px 14px; border-radius: 10px; border: 1px solid #444; background: #1a1a1a; color: #fff; font-size: 16px; }
  .check { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; }
  .check input { width: 20px; height: 20px; margin-top: 3px; }
  button { margin-top: 18px; width: 100%; min-height: 50px; border: 0; border-radius: 12px; background: #FF8080; color: #000; font-weight: 800; font-size: 16px; cursor: pointer; }
  .muted { color: #b3b3b3; font-size: 14px; }
</style>
</head>
<body>
<main>
<a class="lang" href="?lang=${otherLang}">${c.other}</a>
<h1>${c.title}</h1>
${message ? `<div class="msg ${success ? "ok" : "err"}" role="${success ? "status" : "alert"}">${escapeHtml(message)}${!success && (message === c.failed) ? supportLink : ""}</div>` : ""}
${success ? "" : `<p>${c.intro}</p>
<ul><li>${c.inApp}</li><li>${c.web}</li></ul>
<h2>${c.deleted}</h2>
<ul>${c.deletedItems.map((item) => `<li>${item}</li>`).join("")}</ul>
<p class="muted">${c.kept}</p>
<form method="post" action="?lang=${lang}">
  <label for="email">${c.email}</label>
  <input id="email" name="email" type="email" autocomplete="email" required />
  <label for="password">${c.password}</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required />
  <label class="check"><input type="checkbox" name="confirm" value="yes" required /> <span>${c.confirm}</span></label>
  <button type="submit">${c.submit}</button>
</form>
<p class="muted">${c.forgot}${supportLink}</p>`}
</main>
</body>
</html>`);
}

function pickLang(req) {
  return req.query.lang === "en" ? "en" : "es";
}

const page = (req, res) => render(res, { lang: pickLang(req) });

const submit = async (req, res) => {
  const lang = pickLang(req);
  const c = COPY[lang];
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password || req.body?.confirm !== "yes") {
    return render(res, { lang, status: 400, message: c.missing });
  }
  if (tooManyAttempts(req.ip)) return render(res, { lang, status: 429, message: c.limited });

  try {
    const { rows } = await db.query("SELECT id, password_hash FROM users WHERE LOWER(email) = $1", [email]);
    const user = rows[0];
    // Mismo mensaje si el correo no existe, para no revelar qué cuentas hay.
    if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return render(res, { lang, status: 400, message: c.invalid });
    }
    await usersService.remove(user.id);
    attempts.delete(req.ip);
    return render(res, { lang, message: c.done, success: true });
  } catch (error) {
    console.error("[account-deletion] No se pudo eliminar la cuenta:", error.message);
    return render(res, { lang, status: 500, message: c.failed });
  }
};

module.exports = { page, submit, _resetAttempts: () => attempts.clear() };
