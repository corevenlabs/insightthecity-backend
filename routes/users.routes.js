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

const { updateProfile, updateAvatar } = require('../controllers/profile.controller');
const avatarUpload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
router.patch('/me', requireUserAuth, updateProfile);
router.post('/me/avatar', requireUserAuth, (req, res, next) => {
  avatarUpload.single('file')(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, message: 'La foto debe pesar menos de 5 MB' });
    next();
  });
}, updateAvatar);

// --- Administración de usuarios (panel, protegido con token de admin) ---
router.get("/", requireAuth, list);
router.get("/:id", requireAuth, getOne);
router.put("/:id", requireAuth, update);
router.delete("/:id", requireAuth, remove);

module.exports = router;
