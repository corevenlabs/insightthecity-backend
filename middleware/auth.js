const jwt = require("jsonwebtoken");

// Protege rutas de administración: exige un Bearer token válido.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Token requerido" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type === "user") {
      return res.status(403).json({ success: false, message: "Acceso de administrador requerido" });
    }
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Token inválido o expirado" });
  }
}

// Protege rutas de usuarios de la app: exige un Bearer token válido.
// Deja el payload del usuario en req.user.
function requireUserAuth(req, res, next) {
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
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Token inválido o expirado" });
  }
}

module.exports = { requireAuth, requireUserAuth };
