const express = require("express")
const router = express.Router();

const {getChat, enviarMensaje} = require('../controllers/chat.controller')
const { requireUserAuth } = require('../middleware/auth')


router.get("/", requireUserAuth, getChat)
const security=require('../middleware/security-rate-limit');
router.post('/',requireUserAuth,security.limit('chat-minute',20,60,security.user),security.limit('chat-day',300,86400,security.user),enviarMensaje)

module.exports = router
