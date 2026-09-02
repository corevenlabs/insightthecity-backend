const express = require("express")
const router = express.Router();

const {getChat, enviarMensaje} = require('../controllers/chat.controller')
const { requireUserAuth } = require('../middleware/auth')


router.get("/", requireUserAuth, getChat)
router.post("/", requireUserAuth, enviarMensaje)

module.exports = router
