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
