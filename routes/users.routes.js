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
const apple = require('../services/apple-auth.service');
const appleResponse = (fn,status=200) => async (req,res,next) => {
  try { res.status(status).json({ success:true, ...await fn(req) }); }
  catch(error) { if (error.status) return res.status(error.status).json({ success:false, message:error.message, code:error.code }); next(error); }
};
router.post('/apple/challenge',security.limit('apple-challenge',30,300),appleResponse(async () => ({ nonce:await apple.challenge() })));
router.post('/apple/login',security.limit('apple-login',30,300),appleResponse(req => apple.authenticate(req.body)));
router.post('/apple/link',requireUserAuth,security.limit('apple-link',10,300),appleResponse(req => apple.authenticate(req.body,req.user.id)));
router.post('/google/login',security.limit('google-login',20,300),appleResponse(req => require('../services/google-auth.service').authenticate(req.body)));
router.get('/me/deletion-method',requireUserAuth,appleResponse(async req => {
 const user=(await require('../config/db').query('SELECT (password_hash IS NOT NULL) AS has_password,EXISTS(SELECT 1 FROM apple_auth_identities WHERE user_id=users.id) AS has_apple,EXISTS(SELECT 1 FROM google_auth_identities WHERE user_id=users.id) AS has_google FROM users WHERE id=$1',[req.user.id])).rows[0];
 return {method:user?.has_google?'google':user?.has_password?'password':user?.has_apple?'apple':'email'};
}));
router.post('/google/delete',requireUserAuth,security.limit('google-delete',10,300,security.user),appleResponse(req => require('../services/google-deletion.service').requestDeletion(req.user.id,req.body || {}),202));
router.post('/apple/delete',requireUserAuth,security.limit('apple-delete',10,300,security.user),appleResponse(req => apple.requestDeletion(req.user.id,req.user,req.body || {}),202));
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
