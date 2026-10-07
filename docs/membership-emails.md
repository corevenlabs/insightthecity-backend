# Correos de membresía

`services/membership-email.service.js` genera bienvenida, cancelación de renovación y reactivación en español, inglés y portugués. Usa HTML con tablas/estilos inline y una alternativa en texto, con precio y fecha reales (hora de Nueva York). El transporte SMTP de SiteGround no cambia.

La marca coincide con el home: ITC blanco, CLUB y acentos #FDDD56. La imagen de Nueva York se sirve desde `/email-assets/new-york.jpg` (fotografía de Unsplash; origen de descarga: https://images.unsplash.com/photo-1485871981521-5b1fd3805eee).

Los botones usan HTTPS `/app/benefits` y `/app/membership`. Es una página pública sin datos personales que permite abrir `itcclub://email-entry?target=...` y muestra soporte si no está instalada la app. No cambia ni cancela una suscripción al abrir un enlace. La app pide autenticación si hace falta y después conserva el destino. No son Universal Links; abrir la app requiere pulsar el botón de la página puente.

`PUBLIC_BASE_URL` permite cambiar el dominio público; por defecto usa la URL de producción de Cloud Run. Los enlaces legales apuntan a documentos publicados desde el panel. Ningún correo contiene tokens de sesión o identificadores de Stripe.

La bienvenida conserva el control de envío único por suscripción. La cancelación/reactivación se envía solo después de confirmar el cambio de Stripe y guardar el estado. El nuevo diseño se aplica a los siguientes correos, sin reenviar los anteriores.

Validación: `npm test`. Las pruebas cubren HTML y texto, escape de nombres, idiomas, precio real, fecha de NY, destinos fijos y el transporte compartido.
