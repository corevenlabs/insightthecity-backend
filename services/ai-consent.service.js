const db = require("../config/db");

// Aviso y permiso para el chat con IA (App Store 5.1.2(i): informar qué datos se
// comparten con una IA de terceros y obtener permiso explícito antes del primer envío).
// Si cambia lo que se envía a OpenAI, sube VERSION: todos vuelven a ver el aviso.
const VERSION = 1;

const NOTICES = {
  es: {
    title: "Yorki usa inteligencia artificial de OpenAI",
    intro: "Antes de chatear, necesitamos tu permiso para compartir estos datos con OpenAI, el proveedor externo de IA que genera las respuestas:",
    points: [
      "Tus mensajes del chat, incluidos los anteriores, para que Yorki recuerde la conversación.",
      "Tu nombre de perfil, tu idioma y si tienes membresía ITC Club.",
      "Si pides lugares cercanos, tu ubicación solo se usa para buscar en Google Maps. OpenAI recibe los lugares encontrados, no tus coordenadas.",
    ],
    retention: "OpenAI no guarda estas conversaciones ni las usa para entrenar sus modelos. Puede conservarlas hasta 30 días por seguridad y prevención de abuso.",
    advice: "No compartas datos sensibles como salud, finanzas o documentos de identidad.",
    control: "Puedes retirar este permiso cuando quieras en Perfil > Legal y privacidad. Sin permiso, el chat no envía nada y el resto de la app funciona igual.",
  },
  en: {
    title: "Yorki uses OpenAI artificial intelligence",
    intro: "Before chatting, we need your permission to share this data with OpenAI, the third-party AI provider that generates the replies:",
    points: [
      "Your chat messages, including earlier ones, so Yorki can remember the conversation.",
      "Your profile name, your language and whether you have an ITC Club membership.",
      "If you ask for nearby places, your location is only used to search Google Maps. OpenAI receives the places found, not your coordinates.",
    ],
    retention: "OpenAI does not store these conversations or use them to train its models. It may keep them for up to 30 days for safety and abuse prevention.",
    advice: "Do not share sensitive information such as health, financial or identity documents.",
    control: "You can withdraw this permission at any time in Profile > Legal and privacy. Without it, the chat sends nothing and the rest of the app works the same.",
  },
  pt: {
    title: "Yorki usa inteligência artificial da OpenAI",
    intro: "Antes de conversar, precisamos da sua permissão para compartilhar estes dados com a OpenAI, o provedor externo de IA que gera as respostas:",
    points: [
      "Suas mensagens do chat, incluindo as anteriores, para que o Yorki lembre da conversa.",
      "Seu nome de perfil, seu idioma e se você tem assinatura ITC Club.",
      "Se você pedir lugares próximos, sua localização é usada apenas para buscar no Google Maps. A OpenAI recebe os lugares encontrados, não suas coordenadas.",
    ],
    retention: "A OpenAI não guarda essas conversas nem as usa para treinar seus modelos. Ela pode mantê-las por até 30 dias por segurança e prevenção de abuso.",
    advice: "Não compartilhe dados sensíveis como saúde, finanças ou documentos de identidade.",
    control: "Você pode retirar esta permissão quando quiser em Perfil > Jurídico e privacidade. Sem ela, o chat não envia nada e o resto do app funciona normalmente.",
  },
};

function notice(language) {
  return NOTICES[language] || NOTICES.es;
}

function hasConsent(user) {
  return user?.ai_consent_version === VERSION;
}

// Lo que ve la app: si falta el permiso y el texto exacto que debe mostrar.
function status(user) {
  const language = NOTICES[user?.language] ? user.language : "es";
  return {
    version: VERSION,
    accepted: hasConsent(user),
    acceptedAt: hasConsent(user) ? user.ai_consent_at : null,
    language,
    notice: notice(language),
  };
}

async function record(userId, action, language) {
  const lang = NOTICES[language] ? language : "es";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      action === "granted"
        ? "UPDATE users SET ai_consent_version = $2, ai_consent_at = NOW() WHERE id = $1 RETURNING id, ai_consent_version, ai_consent_at, language"
        : "UPDATE users SET ai_consent_version = NULL, ai_consent_at = NULL WHERE id = $1 RETURNING id, ai_consent_version, ai_consent_at, language",
      action === "granted" ? [userId, VERSION] : [userId]
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return null; }
    await client.query(
      `INSERT INTO ai_consent_events (user_id, user_reference, action, version, language, notice)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, `ITC-U-${userId}`, action, VERSION, lang, JSON.stringify(notice(lang))]
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const grant = (userId, language) => record(userId, "granted", language);
const revoke = (userId, language) => record(userId, "revoked", language);

module.exports = { VERSION, NOTICES, notice, hasConsent, status, grant, revoke };
