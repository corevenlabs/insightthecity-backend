const jwt = require("jsonwebtoken");
const db = require("../config/db");
function requireStaff(...roles) {
  return async (req, res, next) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, {algorithms:["HS256"]});
    } catch {
      return res.status(401).json({ message: "Sesión inválida o expirada" });
    }
    if (payload.type && payload.type !== "staff")
      return res.status(403).json({ message: "Acceso al panel requerido" });
    try {
      const { rows } = await db.query(
        "SELECT id,email,name,role,language,phone,is_active,session_version FROM admins WHERE id=$1",
        [payload.id],
      );
      const account = rows[0];
      if (!account?.is_active)
        return res.status(401).json({ message: "Cuenta desactivada" });
      if ((payload.sv ?? 0) !== Number(account.session_version || 0)) return res.status(401).json({message:"Sesión expirada. Inicia sesión nuevamente."});
      if (roles.length && !roles.includes(account.role))
        return res
          .status(403)
          .json({ message: "No tienes permisos para esta acción" });
      req.admin = account;
      next();
    } catch (error) {
      next(error);
    }
  };
}
module.exports = { requireStaff };
