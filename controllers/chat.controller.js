const usersService = require("../services/users.service");
const { getHistory, saveMessage, respond } = require("../services/chat.service");
const aiConsent = require("../services/ai-consent.service");

async function getChat(req, res, next) {
  try {
    const user = await usersService.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    // La memoria permanece en el servidor; cada apertura empieza con una pantalla limpia.
    res.json({ success: true, messages: [], greeting: null, aiConsent: aiConsent.status(user) });
  } catch (error) { next(error); }
}

// POST /api/chat/consent { version } — el usuario acepta el aviso que la app le mostró.
async function grantConsent(req, res, next) {
  try {
    if (req.body?.version !== aiConsent.VERSION) {
      return res.status(409).json({ success: false, code: "AI_CONSENT_OUTDATED", message: "El aviso cambió. Vuelve a abrir el chat." });
    }
    const user = await usersService.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    const updated = await aiConsent.grant(user.id, user.language);
    res.json({ success: true, aiConsent: aiConsent.status({ ...user, ...updated }) });
  } catch (error) { next(error); }
}

// DELETE /api/chat/consent — retira el permiso; el chat deja de enviar datos a OpenAI.
async function revokeConsent(req, res, next) {
  try {
    const user = await usersService.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    const updated = await aiConsent.revoke(user.id, user.language);
    res.json({ success: true, aiConsent: aiConsent.status({ ...user, ...updated }) });
  } catch (error) { next(error); }
}

async function sendMessage(req, res, next) {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ success: false, message: "Escribe un mensaje" });
    if (message.length > 800) return res.status(400).json({ success: false, message: "El mensaje es demasiado largo" });
    const user = await usersService.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    // Sin permiso vigente no se guarda ni se envía nada a OpenAI.
    if (!aiConsent.hasConsent(user)) {
      return res.status(403).json({ success: false, code: "AI_CONSENT_REQUIRED", message: "Acepta el aviso del chat para continuar.", aiConsent: aiConsent.status(user) });
    }
    await saveMessage(user.id, "user", message);
    const history = await getHistory(user.id, 50);
    const result = await respond({
      user,
      history,
      location: {
        lat: typeof req.body?.lat === "number" && Number.isFinite(req.body.lat) ? req.body.lat : undefined,
        lng: typeof req.body?.lng === "number" && Number.isFinite(req.body.lng) ? req.body.lng : undefined,
      },
    });
    const saved = await saveMessage(user.id, "assistant", result.reply);
    res.json({
      success: true,
      reply: result.reply,
      appItems: result.appItems,
      places: result.places,
      messageId: saved.id,
    });
  } catch (error) { next(error); }
}

module.exports = { getChat, enviarMensaje: sendMessage, grantConsent, revokeConsent };
