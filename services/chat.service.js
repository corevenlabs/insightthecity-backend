const db = require("../config/db");
const openai = require("../config/openai");

const obtenerUsuarios = async () => {
  const { rows } = await db.query("SELECT * FROM users");
  return rows;
};
const responderChat = async (message) => {

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: message,
  });

  return response.output_text;
};


const guardarMensaje = async ( userId, role, message) =>{
    await db.query(`INSERT INTO chat_messages (user_id, role, message) VALUES ($1,$2,$3)`, [userId, role, message])
}


module.exports = {
  obtenerUsuarios,
  responderChat,
  guardarMensaje
};