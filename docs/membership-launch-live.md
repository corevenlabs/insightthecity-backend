# Campaña privada de 300 invitaciones — separada de la membresía normal

## Recorrido

1. ITC selecciona un destinatario de la lista. El envío inicial genera un enlace
   personal asociado al correo, con vencimiento de 30 días. Se reservan como máximo
   300 invitaciones por entorno, no 300 cobros. Las cuentas ya existentes siguen
   excluidas; no se importa una waitlist ni se envía una campaña al desplegar.
2. El enlace abre `/membership-invitation#TOKEN`. El destinatario llena nombre,
   correo y contraseña, registra tarjeta en Stripe Elements y marca las dos casillas
   de términos/privacidad y renovación automática. El backend vuelve a validarlas.
3. Se crea la cuenta sin premium; no hay correo intermedio de cuenta creada. Stripe
   verifica la tarjeta con SetupIntent off_session (incluida autenticación del banco).
4. Solo un SetupIntent confirmado del cliente y de la invitación permite crear la
   suscripción: 30 días gratis desde esa creación, tarjeta predeterminada,
   `collection_method: charge_automatically`, precio mensual USD 499 centavos.
5. El backend verifica la suscripción, activa premium y envía la bienvenida con las
   fechas/precio y enlaces de descarga. El retorno del navegador no es prueba de pago.
   Si falla SMTP, conserva la membresía y reintenta la bienvenida; no crea otro trial.
6. Al terminar el trial, Stripe intenta cobrar US$4.99 y renueva mensualmente hasta
   cancelar. Un rechazo bancario no equivale a un cobro exitoso. Cancelar antes del
   fin del trial evita la primera cuota y conserva el acceso hasta su vencimiento.

## Separación de facturación

La membresía normal conserva `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, su cliente
Stripe y checkout sin trial. La campaña live usa otro cliente/cache y exclusivamente:
`MEMBERSHIP_LIVE_SECRET_KEY`, `MEMBERSHIP_LIVE_PUBLISHABLE_KEY`,
`MEMBERSHIP_LIVE_PRICE_ID`, `MEMBERSHIP_LIVE_WEBHOOK_SECRET`.
Precio comunicado: `price_1U5v68I4w6DUYfoWp4aXayIy`.
Se puede usar el mismo producto/precio de Stripe: la promoción pertenece a la
suscripción invitada, no a todos los compradores del producto.

`users.stripe_billing_source` conserva el origen normal/campaign. Cancelación,
portal, sincronización y trabajos de borrado usan ese origen. Las invitaciones ya
existentes quedan `livemode=false` y no se aceptan en campaña live. La migración
identifica las cuentas vinculadas a invitaciones anteriores; revisar esos registros
de prueba antes de cambiar el entorno de la campaña, sin borrar usuarios ni tocar
suscripciones reales automáticamente.

El webhook público conserva la URL `/api/payment/webhook`. Verifica por separado
las firmas normal y de campaña. Los eventos normales que llegan al destino de la
campaña se ignoran allí. Apagar nuevas activaciones no impide sincronizar suscriptores.

## Configuración y lanzamiento posterior

- El workflow mantiene los bindings normales. `MEMBERSHIP_LIVE_CONFIGURED=true`
  añade los cuatro secretos de campaña y `MEMBERSHIP_CAMPAIGN_MODE=live`.
- La campaña sigue apagada salvo `MEMBERSHIP_LAUNCH_LIVE_ENABLED=true`.
- Live bloquea registro/preparación sin términos, privacidad y membresía publicados.
- Verificar los permisos del runtime y los necesarios para el despliegue; no ampliar
  permisos de lectura a usuarios sin autorización.
- Desde Cloud Shell autorizado, ejecutar `node scripts/verify-membership-live.js`
  con las dependencias instaladas. Es solo lectura. Verifica cuenta de la clave
  secreta, precio y eventos del webhook. El emparejamiento de clave pública y firma
  del webhook requiere verificación adicional; no lo demuestra este script.
- Configurar URLs oficiales de descarga y conservarlas en el despliegue. Verificar
  recordatorios de fin de prueba y recuperación de impagos en Stripe.
- Validar en Sandbox invitación, tarjeta rechazada, 3DS, concurrencia, primer cobro
  con reloj de prueba, cancelación y correos. No hacer cobros reales como pruebas.

## Emisión de la invitación inicial

`scripts/send-membership-invitation.js` exige un destinatario explícito mediante
`MEMBERSHIP_INVITE_EMAIL` y el argumento `--send`. Sin ese argumento no hace envíos.
Verifica campaña y documentos legales; usa el correo de invitación aprobado, salta
invitaciones ya enviadas y no imprime enlaces privados ni credenciales. La aceptación
SMTP queda registrada, pero no garantiza llegada a la bandeja. Si SMTP acepta y luego
falla guardar la marca, revisar manualmente antes de reintentar para evitar reenvíos.
La lista real y un proceso de importación/envío por lotes siguen pendientes.

`scripts/send-membership-launch-test.js` queda exclusivamente para Sandbox.
No hay envío automático al desplegar ni correo de activación antes de verificar Stripe.

## Avisos de pago fallido y autenticación pendiente

El webhook también debe suscribirse a `invoice.payment_failed`,
`invoice.payment_action_required` e `invoice.paid`, en cada destino de membresías
que deba recibir avisos. Los cinco eventos originales no cubren estos avisos.
Se consulta la factura vigente en la cuenta Stripe correspondiente, se comprueba
cliente/suscripción/usuario activo y se guarda un aviso pendiente por factura y
origen. Eventos repetidos no vuelven a enviar avisos confirmados. Los fallos SMTP
se reintentan mediante el worker existente de correos; la factura se consulta otra
vez antes del envío y se omiten las ya pagadas. La entrega SMTP y la marca SQL no
son una transacción: una caída entre ambas puede producir un reenvío excepcional.

Plantilla en es/en/pt: Roboto Condensed Black rasterizada para banners y Arial para
el cuerpo, negro/amarillo y recursos existentes de ITC. El importe corresponde al
saldo real de la factura; la fecha de próximo intento se muestra solo si Stripe la
indica. El botón abre la factura alojada en Stripe (HTTPS y host validado); no se
incluyen datos de tarjeta ni errores bancarios técnicos. El acceso premium sigue
las reglas existentes de suscripción, sin suspenderse por el envío de un aviso.

`output/payment-failed-preview/correo-es.html` es la plantilla HTML de ejemplo.
La imagen PNG es una composición visual con los recursos y las fuentes reales,
no una captura de Gmail/Outlook; falta comprobar esos clientes antes de publicar.
Los recursos PNG del banner se generan con
`scripts/render-payment-failed-preview.py` (Pillow) para no sustituir tipografías.


## Enlace live recibido — checkout alojado opcional

Verificado por API de solo lectura: `https://buy.stripe.com/00w14n4bs1yPdFjgUl8Vi05`,
`plink_1USQAsI4w6DUYfoWkQ1TzQBT`, activo/live, tarjeta obligatoria, trial 30 días,
precio `price_1USQAsI4w6DUYfoWzFKl09ib` USD 499/mes. Este precio reemplaza el precio
anterior **solo en MEMBERSHIP_LIVE_PRICE_ID**, no en el plan normal.

Seleccionar `MEMBERSHIP_CAMPAIGN_CHECKOUT=payment_link` conserva registro y ambas
aceptaciones en ITC, seguido de redirección al checkout Stripe con correo bloqueado
prellenado y referencia firmada. La bienvenida solo se envía tras consultar Stripe,
comprobar precio/período/cliente/correo e identificar la invitación. Las suscripciones
se vinculan con metadata para los posteriores eventos y se cancela sin prorrateo ni
factura una segunda suscripción de prueba del mismo destinatario verificado.

Pendientes del enlace antes de publicar:
- Configurar el retorno tras checkout a
  `https://itc-backend-1031252664334.us-east1.run.app/membership-activation?session_id={CHECKOUT_SESSION_ID}`.
  Al inspeccionarlo todavía usaba confirmación alojada en Stripe.
- El enlace inspeccionado tenía `consent_collection.terms_of_service=none`.
  Las dos aceptaciones se recogen y versionan antes en ITC; si se exige también la
  casilla en Stripe, configurarla cuando existan URLs públicas aprobadas.
- Revisar eventos del webhook (incluido checkout completado) y las credenciales.

La plataforma de correo debe enviar el enlace de **registro ITC con invitación**,
no el enlace desnudo `buy.stripe.com`: una compra directa allí sin referencia firmada
no permite crear/identificar la cuenta ni comprobar los 300 destinatarios.
No se ha implementado un enlace de registro general con lista autorizada/OTP.
Estos cambios no crean pagos ni modifican el enlace live hasta que se publique.


## Conservar secretos sin activar la campaña

`MEMBERSHIP_LIVE_SECRETS_ATTACHED=true` conserva los cuatro bindings live en
cada despliegue. No cambia el modo de campaña a live ni permite nuevas activaciones.
Es independiente de `MEMBERSHIP_LIVE_CONFIGURED` y
`MEMBERSHIP_LAUNCH_LIVE_ENABLED`. Las pruebas de Sandbox continúan disponibles.
