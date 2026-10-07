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
const newsRouter = require("./routes/news.routes");
const partnershipsRouter = require("./routes/partnerships.routes");
const benefitsRouter = require("./routes/benefits.routes");
const guidesRouter = require("./routes/guides.routes");
const legalRouter = require("./routes/legal.routes");
const stripeWebhookRouter = require("./routes/stripe.webhook");
const { page: legalPage } = require("./controllers/legal.controller");

const manejadorErrors = require("./middleware/manejadorErrores")


const app = express()

// Content-Range es necesario para la paginación de react-admin.
app.use(cors({ exposedHeaders: ["Content-Range"] }))

// Stripe necesita el body original para verificar la firma del webhook.
// Solo se monta si el secreto está configurado (sin él, la membresía se
// sincroniza igualmente al consultar /api/users/me).
if (process.env.STRIPE_WEBHOOK_SECRET) {
  app.use("/api/payment/webhook", express.raw({ type: "application/json" }), stripeWebhookRouter)
}

app.use(express.json())

// Sirve las imágenes subidas en desarrollo (driver local).
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

app.use("/email-assets", express.static(path.join(__dirname, "public/email"), { maxAge: "7d" }));
app.get("/app/:target", require("./controllers/app-link.controller").appLink);

app.get("/health", (req, res) => res.json({ ok: true }))

app.use("/api/chat", chatRouter)
app.use("/api/places", placesRouter)
app.use("/api/payment", paymentRoutes);
app.use("/api/experiences", experiencesRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/news", newsRouter);
app.use("/api/partnerships", partnershipsRouter);
app.use(benefitsRouter);
app.use('/api/guides', guidesRouter);
app.use("/api/legal", legalRouter);
// Páginas públicas de Términos, Privacidad, etc. (URLs para las tiendas de apps).
app.get("/legal/:slug", legalPage);

app.use(manejadorErrors)




const PORT = process.env.PORT || 3000
app.listen(PORT, () =>{
    console.log(`Servidor corriendo en puerto ${PORT}`)
})
