require("dotenv").config()
if (process.env.APPLE_TEAM_ID) require("./services/apple-tokens.service").validateConfiguration();
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
const legalRouter = require("./routes/legal.routes");
const stripeWebhookRouter = require("./routes/stripe.webhook");
const { page: legalPage } = require("./controllers/legal.controller");

const manejadorErrors = require("./middleware/manejadorErrores")


const app = express()
app.use(require('./middleware/brand-typography'));
app.use('/brand-assets', express.static(path.join(__dirname,'public/brand'),{maxAge:'7d',setHeaders(res){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','cross-origin');}}));
// Cloud Run pone un proxy delante: así req.ip y req.protocol son los del cliente.
app.set("trust proxy", 1)

// Content-Range es necesario para la paginación de react-admin.
app.use(require('./middleware/security-http').headers);
app.use(require('./middleware/security-http').cors);

// Stripe necesita el body original para verificar la firma del webhook.
// Solo se monta si el secreto está configurado (sin él, la membresía se
// sincroniza igualmente al consultar /api/users/me).
if (process.env.STRIPE_WEBHOOK_SECRET) {
  app.use("/api/payment/webhook", express.raw({ type: "application/json" }), stripeWebhookRouter)
}

if (process.env.PARTNER_STRIPE_WEBHOOK_SECRET) {
  app.use("/api/partners/payment/webhook", express.raw({ type: "application/json" }), require("./routes/partner-payment.webhook"));
}

app.use(express.json({limit:"1mb"}));
app.use('/api', (_req,res,next)=>{res.set('Cache-Control','no-store');next();});

// Sirve las imágenes subidas en desarrollo (driver local).
app.use('/uploads', (req,res,next)=>{
  if (/^\/(avatars|guides)(\/|$)/i.test(req.path)) return res.sendStatus(404);
  next();
}, express.static(path.join(__dirname,'uploads')));

app.use("/email-assets", express.static(path.join(__dirname, "public/email"), { maxAge: "7d" }));
app.get('/app/download', require('./controllers/membership-download.controller').download);
app.get('/membership-activation', require('./middleware/security-rate-limit').limit('launch-return',20,60), require('./controllers/membership-download.controller').activation);
app.get("/app/:target", require("./controllers/app-link.controller").appLink);

app.use('/account-deletion-assets', express.static(path.join(__dirname,'public/account-deletion')));
app.get(['/delete-account', '/eliminar-cuenta'], (req,res)=>{
 res.set('Cache-Control','no-store').set('Referrer-Policy','no-referrer').set('X-Content-Type-Options','nosniff');
 res.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 res.type('html').send(require('./services/account-deletion-page').page(req.query.lang));
});
app.use('/membership-launch-assets', express.static(path.join(__dirname,'public/membership-launch')));
app.get('/membership-invitation', (req,res)=>{
 res.set('Cache-Control','no-store').set('Referrer-Policy','no-referrer');
 res.set('Content-Security-Policy',"default-src 'none'; script-src 'self' https://js.stripe.com; style-src 'self'; img-src 'self' https://*.stripe.com; connect-src 'self' https://api.stripe.com https://*.stripe.com https://*.stripe.network; frame-src https://js.stripe.com https://hooks.stripe.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 res.type('html').send(require('./services/membership-launch-page').page());
});
app.get("/health", (req, res) => res.json({ ok: true }))

app.use("/api/chat", chatRouter)
app.use("/api/places", placesRouter)
app.use("/api/payment", paymentRoutes);
app.use("/api/payment/launch", require("./routes/membership-launch.routes"));
app.use("/api/experiences", experiencesRouter);
app.use("/api/experience-drafts", require("./routes/experience-drafts.routes"));
app.use("/api/auth", authRouter);
app.use("/api/staff", require("./routes/staff.routes"));
app.use("/api/partners", require("./routes/partner.routes"));
app.get("/business/:id", require("./controllers/partner-preview.controller"));
app.use("/api/users", usersRouter);
app.use("/api/account-deletions", require("./routes/account-deletion.routes"));
app.use("/api/uploads", uploadsRouter);
app.use("/api/news", newsRouter);
app.use("/api/partnerships", partnershipsRouter);
app.use(benefitsRouter);
// Compatibility only: older installed apps receive an empty retired catalog.
app.get(['/api/guides', '/api/guides/mine', '/api/guides/admin'], (_req,res)=>res.json([]));
app.use('/api/guides', (_req,res)=>res.status(410).json({success:false,message:'Este contenido ya no está disponible.'}));
app.use("/api/legal", legalRouter);
// Páginas públicas de Términos, Privacidad, etc. (URLs para las tiendas de apps).
app.get("/legal/:slug", legalPage);
// Eliminación de cuenta sin instalar la app (URL que se declara en Google Play).
// Las solicitudes usan el flujo con código y confirmación de /api/account-deletions.
app.post(["/eliminar-cuenta", "/delete-account"], (req,res)=>res.redirect(303, "/delete-account"));

app.use(manejadorErrors)




const PORT = process.env.PORT || 3000
if (require.main === module) app.listen(PORT, () =>{
    console.log(`Node.js runtime: ${process.versions.node}`)
    console.log(`Servidor corriendo en puerto ${PORT}`)
})

module.exports=app;
