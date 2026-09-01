const usersService = require("../services/users.service");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fila DB -> forma de la API para el panel.
function serialize(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    is_premium: u.is_premium,
    is_active: u.is_active,
    language: u.language || "es",
    created_at: u.created_at,
  };
}

const register = async (req, res, next) => {
  try {
    const { name, email, password, language = "es" } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "email y password requeridos" });
    }
    if (!EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ success: false, message: "Correo inválido" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: "La contraseña debe tener al menos 8 caracteres" });
    }
    if (!["es", "en", "pt"].includes(language)) {
      return res.status(400).json({ success: false, message: "Idioma no válido" });
    }

    const result = await usersService.register({ name, email, password, language });
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
    if (err.status === 403) {
      return res.status(403).json({ success: false, message: err.message });
    }
    next(err);
  }
};

const me = async (req, res, next) => {
  try {
    const user = await usersService.findById(req.user.id);
    // Si la cuenta ya no existe o fue desactivada, forzamos cierre de sesión.
    if (!user || user.is_active === false) {
      return res.status(401).json({ success: false, message: "Sesión no válida" });
    }
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

// ---- Administración (panel, protegido con requireAuth de admin) ----

// GET /api/users?_start=0&_end=24&_sort=created_at&_order=DESC&q=&premium=&active=
const list = async (req, res, next) => {
  try {
    const { _start, _end, _sort, _order, q, premium, active } = req.query;
    const start = _start !== undefined ? parseInt(_start, 10) : undefined;
    const end = _end !== undefined ? parseInt(_end, 10) : undefined;

    const { rows, total } = await usersService.listForAdmin({
      sort: _sort,
      order: _order,
      start,
      end,
      filter: { q, premium, active },
    });

    res.set(
      "Content-Range",
      `users ${start || 0}-${Math.max(start || 0, (end || rows.length) - 1)}/${total}`
    );
    res.json(rows.map(serialize));
  } catch (err) {
    next(err);
  }
};

const getOne = async (req, res, next) => {
  try {
    const user = await usersService.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "No encontrado" });
    res.json(serialize(user));
  } catch (err) {
    next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const { is_premium, is_active, name } = req.body || {};
    const user = await usersService.adminUpdate(req.params.id, { is_premium, is_active, name });
    if (!user) return res.status(404).json({ success: false, message: "No encontrado" });
    res.json(serialize(user));
  } catch (err) {
    next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    const existing = await usersService.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "No encontrado" });
    await usersService.remove(req.params.id);
    res.json(serialize(existing)); // el panel espera el registro borrado
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, me, list, getOne, update, remove };
