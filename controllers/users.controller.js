const usersService = require("../services/users.service");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "email y password requeridos" });
    }
    if (!EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ success: false, message: "Correo inválido" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: "La contraseña debe tener al menos 8 caracteres" });
    }

    const result = await usersService.register({ name, email, password });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ success: false, message: err.message });
    }
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "email y password requeridos" });
    }

    const result = await usersService.login(email, password);
    if (!result) {
      return res.status(401).json({ success: false, message: "Credenciales inválidas" });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

const me = async (req, res, next) => {
  try {
    const user = await usersService.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "Usuario no encontrado" });
    }
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, me };
