const express = require("express");
const router = express.Router();

const {
  register,
  login,
  me,
  activatePremium,
  list,
  getOne,
  update,
  remove,
} = require("../controllers/users.controller");
const { requireAuth, requireUserAuth } = require("../middleware/auth");

// --- Auth de usuarios de la app móvil ---
router.post("/register", register);
router.post("/login", login);
router.get("/me", requireUserAuth, me); // literal antes que "/:id"
router.post("/me/activate-premium", requireUserAuth, activatePremium);

// --- Administración de usuarios (panel, protegido con token de admin) ---
router.get("/", requireAuth, list);
router.get("/:id", requireAuth, getOne);
router.put("/:id", requireAuth, update);
router.delete("/:id", requireAuth, remove);

module.exports = router;
