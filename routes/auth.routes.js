const express = require("express");
const router = express.Router();

const { login } = require("../controllers/auth.controller");

router.post('/login',require('../middleware/auth-input'),...require('../middleware/security-rate-limit').auth('staff-login',15),login);

module.exports = router;
