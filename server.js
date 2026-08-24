require("dotenv").config()
const path = require("path")
const express = require("express")
const cors = require("cors")


const chatRouter = require("./routes/chatBoot")
const placesRouter = require("./routes/places.routes");
const paymentRoutes = require("./routes/payment.routes");
const experiencesRouter = require("./routes/experiences.routes");
const authRouter = require("./routes/auth.routes");
const usersRouter = require("./routes/users.routes");
const uploadsRouter = require("./routes/uploads.routes");
const stripeWebhookRouter = require("./routes/stripe.webhook");

const manejadorErrors = require("./middleware/manejadorErrores")


const app = express()

// Content-Range es necesario para la paginación de react-admin.
app.use(cors({ exposedHeaders: ["Content-Range"] }))

// Stripe necesita el body original para verificar la firma del webhook.
app.use("/api/payment/webhook", express.raw({ type: "application/json" }), stripeWebhookRouter)

app.use(express.json())

// Sirve las imágenes subidas en desarrollo (driver local).
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

app.get("/health", (req, res) => res.json({ ok: true }))

app.use("/api/chat", chatRouter)
app.use("/api/places", placesRouter)
app.use("/api/payment", paymentRoutes);
app.use("/api/experiences", experiencesRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/uploads", uploadsRouter);

app.use(manejadorErrors)




const PORT = process.env.PORT || 3000
app.listen(PORT, () =>{
    console.log(`Servidor corriendo en puerto ${PORT}`)
})
