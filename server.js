require("dotenv").config()
const db = require("./config/db");
const express = require("express")
const cors = require("cors")


const chatRouter = require("./routes/chatBoot")
const placesRouter = require("./routes/places.routes");
const paymentRoutes = require("./routes/payment.routes");

const manejadorErrors = require("./middleware/manejadorErrores")


const app = express()
app.use(cors())

app.use(express.json())
app.use("/api/chat", chatRouter)
app.use("/api/places", placesRouter)
app.use("/api/payment", paymentRoutes);

app.use(manejadorErrors)




const PORT = process.env.PORT || 3000
app.listen(PORT, () =>{
    console.log(`Servidor corriendo en puerto ${PORT}`)
})