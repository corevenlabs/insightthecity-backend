const db = require("../config/db")

const { obtenerUsuarios, responderChat, guardarMensaje } = require("../services/chat.service");

const getChat = async (req, res, next) => {
    try {

        const users = await obtenerUsuarios();

        res.json({
            success: true,
            users
        });

    } catch (error) {
        next(error);
    }
};

const enviarMensaje = async (req, res, next) => {
    try {
        const { message } = req.body

        await guardarMensaje(
            1,
            "user",
            message
        );

        const respuesta = await responderChat(message)

        await guardarMensaje(
            1,
            "assistant",
            respuesta
        );

        res.json({
            success: true,
            reply: respuesta
        });


    } catch (error) {
        next(error)
    }
}



module.exports = {
    getChat,
    enviarMensaje,

};