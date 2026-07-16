const express = require("express")
const router = express.Router();

const {getChat, enviarMensaje} = require('../controllers/chat.controller')


router.get("/", getChat)
router.post("/", enviarMensaje)

module.exports = router