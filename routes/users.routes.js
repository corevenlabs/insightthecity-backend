const express = require("express");
const router = express.Router();

const {
  register,
  login,
  me,
  deleteMe,
  list,
  getOne,
  update,
  remove,
} = require("../controllers/users.controller");
const { requireAuth, requireUserAuth } = require("../middleware/auth");
const passwordReset = require('../controllers/password-reset.controller');

// --- Auth de usuarios de la app móvil ---
const security=require('../middleware/security-rate-limit');
router.post('/register',require('../middleware/auth-input'),security.limit('signup',1000,3600),security.limit('signup-email',5,3600,security.email),register);
router.post('/login',require('../middleware/auth-input'),...security.auth('user-login'),login);
router.post('/password-reset/request',...security.auth('password-request',10),passwordReset.requestReset);
router.post('/password-reset/confirm',...security.auth('password-confirm',30),passwordReset.resetPassword);
router.get("/me", requireUserAuth, me); // literal antes que "/:id"
router.delete("/me", requireUserAuth, deleteMe);

const { updateProfile, updateAvatar, getAvatar } = require('../controllers/profile.controller');
const avatarUpload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, fieldSize: 7 * 1024 * 1024, files: 1, fields: 1 } });
router.get('/me/avatar',requireUserAuth,security.limit('avatar-read',60,60,security.user),getAvatar);
router.patch('/me', requireUserAuth, updateProfile);
router.post('/me/avatar', requireUserAuth,security.limit('avatar',30,3600,security.user), (req, res, next) => {
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
