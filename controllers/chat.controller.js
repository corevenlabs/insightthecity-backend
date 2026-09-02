const usersService = require("../services/users.service");
const { getHistory, saveMessage, respond, greetingFor } = require("../services/chat.service");

async function getChat(req, res, next) {
  try {
    const user = await usersService.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    const history = await getHistory(user.id);
    res.json({ success: true, messages: history, greeting: history.length ? null : greetingFor(user) });
  } catch (error) { next(error); }
}

async function sendMessage(req, res, next) {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ success: false, message: "Escribe un mensaje" });
    if (message.length > 800) return res.status(400).json({ success: false, message: "El mensaje es demasiado largo" });
    const user = await usersService.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    await saveMessage(user.id, "user", message);
    const history = await getHistory(user.id, 12);
    const result = await respond({
      user,
      history,
      location: { lat: Number(req.body?.lat), lng: Number(req.body?.lng) },
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

module.exports = { getChat, enviarMensaje: sendMessage };
