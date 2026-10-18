# Lanzamiento de membresías — Sandbox

Implementación separada del checkout normal y de los socios comerciales. Solo funciona con `MEMBERSHIP_LAUNCH_TEST_ENABLED=true` y una clave `sk_test_` de membresías. No activa la campaña real.

- Máximo 300 invitaciones emitidas, bajo bloqueo transaccional. Cada invitación reserva un cupo; activar checkout no se contabiliza como un pago. No se ha importado la waitlist.
- Email normalizado y token se guardan con HMAC; no hay tokens en logs ni URLs del servidor (fragmento privado conservado para poder recargar la página; nunca se transmite por HTTP).
- La invitación vence en 30 días, independiente de los 30 días de prueba de la suscripción. Solo se admite la cuenta destinataria, activa y sin suscripción previa. Reenviar antes de iniciar checkout invalida el token anterior.
- Registro obligatorio desde la invitación para usuarios nuevos, con nombre, correo destinatario, contraseña y aceptación legal. No ofrece iniciar sesión con una cuenta existente. Registro y vinculación son atómicos; se puede retomar una activación pendiente con el mismo enlace y la contraseña creada allí. Crear la cuenta no inicia los 30 días.
- Consentimiento explícito y snapshot legal antes del checkout; la publicación de los términos de membresía sigue pendiente del documento aprobado. Pruebas no equivalen a autorización para lanzamiento comercial.
- Checkout de Stripe exige tarjeta y configura `trial_period_days=30`. Moneda USD, 499 centavos cada mes. Se cancela si falta método de pago al terminar la prueba. Stripe muestra la fecha exacta del primer cargo.
- Solicitudes simultáneas reutilizan el checkout abierto. Solo Stripe verificado activa el acceso, mediante webhook o retorno. Una invitación no se reutiliza al eliminar una cuenta (queda el hash mínimo).
- Cancelar renovación durante la prueba conserva acceso hasta el fin del período y evita el primer cargo. Los flujos de cancelación y borrado existentes se conservan.
- `scripts/send-membership-launch-test.js` envía solo a la dirección autorizada de prueba. La dirección no habilita una lista pública de promociones.

Despliegue: claves en Secret Manager, configuración preparada únicamente si la cuenta existente ya es test y coincide con la cuenta nueva. Nunca reemplaza una clave live. Claves de socios independientes.

Validación: tests unitarios existentes, integración PostgreSQL local, prueba con reloj de Stripe y cliente sintético, página y consentimiento en navegador. La prueba completa con la cuenta del destinatario la realiza el usuario; nunca se pide su contraseña ni tarjeta real.

## Correos aprobados y descarga

- Correo 2: después de confirmar el registro en base de datos. Marca de envío atómica por invitación; los reintentos del registro no duplican el correo. Si SMTP falla, el registro se conserva y se libera la marca para reintentar al retomar la invitación.
- Correo 3: plantilla española aprobada únicamente cuando Stripe confirma un período `trialing`; reutiliza la protección existente de un acuse por suscripción. Fecha y precio provienen de Stripe.
- Banners con tipografía condensada rasterizada para evitar sustitución de fuentes en correo; cuerpo Arial y distintivos oficiales de las tiendas. Fuentes de distintivos: tools.applemediaservices.com y play.google.com.
- El retorno de este checkout abre `/membership-activation`, que consulta la sesión a Stripe antes de confirmar el período gratuito. Cancelar el checkout vuelve a la invitación privada.
- `/app/download?platform=ios|android` admite destinos oficiales configurados en `APP_STORE_DOWNLOAD_URL` / `GOOGLE_PLAY_DOWNLOAD_URL`. Sin ellos, muestra descarga todavía no disponible. **Enlaces reales pendientes del dueño.** No se inventan URLs de tienda.
- No se automatiza la invitación inicial: la envía el dueño. No se envían correos retroactivos al desplegar.

## Registro y tarjeta en una sola página

El enlace privado abre `/membership-invitation#TOKEN`. Stripe.js monta Payment
Element con `mode: setup` y tarjeta exclusivamente. Antes de llamar al backend,
la página exige datos válidos, tarjeta completa y ambas casillas desmarcadas por
defecto (términos/privacidad y renovación). `register` y `prepare` vuelven a exigir
ambos booleanos. Se conservan las versiones y copias de documentos aceptados,
usuario, fecha y aviso de renovación mediante `legal_acceptances`.

`prepare` guarda un SetupIntent de uso `off_session` asociado al cliente y la
invitación. `complete` consulta ese SetupIntent en Stripe, comprueba titularidad,
modo de prueba y estado `succeeded`, y crea una sola suscripción con tarjeta
predeterminada, 30 días de prueba y el precio mensual existente de US$4.99.
Bloqueos SQL e idempotencia de Stripe protegen los reintentos. Un checkout alojado
antiguo se vence antes de preparar la tarjeta; no puede crearse otro checkout
alojado después de comenzar el formulario integrado. Los datos completos de la
tarjeta nunca pasan por el backend de ITC.

La cuenta puede quedar creada sin activar si la tarjeta es rechazada. La misma
invitación permite volver a entrar con la contraseña elegida. Una verificación
bancaria puede requerir pasos adicionales; un parámetro de retorno nunca activa
la membresía sin consultar Stripe. La sesión temporal de recuperación vive en
sessionStorage durante 30 minutos; no almacena la contraseña ni la tarjeta.

Tras confirmar Stripe, la página muestra el aviso aprobado, correo del usuario,
badges oficiales de descarga y reenvío de bienvenida. Se elimina el envío de
"Cuenta creada". El correo de bienvenida conserva fechas y precio de Stripe.
Las tiendas siguen pasando por `/app/download` hasta configurar destinos reales.

Los fallos de correo no revocan la membresía. Los envíos pendientes tienen lease
recuperable de 10 minutos y espera exponencial de hasta una hora. El workflow
`membership-email-retries.yml` los procesa periódicamente (la programación de
GitHub puede demorarse); también se reintentan al sincronizar la cuenta. Reenvío
manual: autenticación, invitación propia activada, mínimo 60 segundos y máximo
5 solicitudes por día. La aceptación SMTP no garantiza recepción en bandeja.

Configuración adicional: variable pública de GitHub
`MEMBERSHIP_SANDBOX_PUBLISHABLE_KEY`, expuesta en Cloud Run como
`STRIPE_PUBLISHABLE_KEY`. Debe corresponder al mismo Sandbox de la clave secreta;
no habilita cobros reales ni sustituye las claves de socios.

Pruebas locales aisladas (Stripe y correo simulados):

```sh
DB_HOST=127.0.0.1 DB_PORT=55440 DB_USER=itc_test DB_DATABASE=itc_crm_test DB_SSL=false \
  node --test --test-concurrency=1 tests/membership-launch.integration.js tests/membership-launch-unified.integration.js
```

La prueba de navegador adicional utiliza Payment Element y tarjetas reales de
Sandbox (rechazo y 4242). Su respuesta final de activación está aislada para no
crear suscripciones cuyos webhooks puedan afectar usuarios de producción.

Pendiente editorial detectado antes del despliegue: los tres endpoints públicos
`/api/legal/terms`, `/api/legal/privacy` y `/api/legal/subscription` devolvían 404
("Este documento aún no está publicado"). No se redactan ni publican textos en
esta entrega. El flujo continúa exclusivamente en Sandbox, identificado en la
pantalla, y debe recibir documentos aprobados y publicados antes de utilizarse
con usuarios/cobros reales. Mientras no exista un documento publicado, el sistema
anterior de evidencia conserva la aceptación sin versión; esto no sustituye el
texto legal aprobado ni debe describirse como evidencia de una versión vigente.
