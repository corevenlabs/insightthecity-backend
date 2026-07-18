const authService = require("../services/auth.service");

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "email y password requeridos" });
    }

    const result = await authService.login(email, password);
    if (!result) {
      return res.status(401).json({ success: false, message: "Credenciales inválidas" });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

module.exports = { login };
