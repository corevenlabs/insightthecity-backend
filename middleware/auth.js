const jwt = require("jsonwebtoken");

// Protege rutas de administración: exige un Bearer token válido.
const requireAuth = require('./staff').requireStaff('admin');

// Protege rutas de usuarios de la app: exige un Bearer token válido.
// Deja el payload del usuario en req.user.
async function requireUserAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Token requerido" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== "user") {
      return res.status(403).json({ success: false, message: "Acceso de usuario requerido" });
    }
    const user = (await require("../config/db").query("SELECT is_active FROM users WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM account_deletions WHERE user_id=$1 AND status='pending')", [payload.id])).rows[0];
    if (!user || !user.is_active) return res.status(403).json({ success: false, message: "Cuenta no disponible" });
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Token inválido o expirado" });
  }
}

module.exports = { requireAuth, requireUserAuth };
