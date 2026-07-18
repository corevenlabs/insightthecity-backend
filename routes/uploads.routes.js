const express = require("express");
const router = express.Router();
const multer = require("multer");

const { uploadOne } = require("../controllers/uploads.controller");
const { requireAuth } = require("../middleware/auth");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Solo se permiten imágenes"));
  },
});

router.post("/", requireAuth, upload.single("file"), uploadOne);

module.exports = router;
