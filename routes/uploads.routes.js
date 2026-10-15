const express = require("express");
const router = express.Router();
const multer = require("multer");

const { uploadOne } = require("../controllers/uploads.controller");
const requireAuth = require('../middleware/staff').requireStaff('admin','editor');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 4 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error("Solo se permiten imágenes"),{status:400}));
  },
});

const security=require('../middleware/security-rate-limit');
router.post('/',requireAuth,security.limit('staff-upload',100,60,security.staff),upload.single('file'),uploadOne);

module.exports = router;
