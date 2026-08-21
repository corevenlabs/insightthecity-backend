const express = require("express");
const router = express.Router();

const { register, login, me } = require("../controllers/users.controller");
const { requireUserAuth } = require("../middleware/auth");

// Auth de usuarios de la app móvil.
router.post("/register", register);
router.post("/login", login);
router.get("/me", requireUserAuth, me);

module.exports = router;
