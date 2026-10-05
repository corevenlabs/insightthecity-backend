# Recuperación por SiteGround

La app mantiene el flujo de código de ocho dígitos, válido durante 15 minutos.
SMTP_HOST selecciona SMTP; sin ese valor se conserva compatibilidad con Resend.
El puerto 465 usa TLS desde la conexión y valida el certificado. Otros puertos
requieren STARTTLS. La contraseña y los códigos no se registran en los logs.

## Prueba local

Configurar `.env.local` (ignorado por Git) con los valores de `.env.example` y
la contraseña real del buzón. Ejecutar:

```sh
node scripts/verify-smtp.js
node scripts/verify-smtp.js correo-de-prueba@example.com
node --test tests/*.test.js
```

La primera orden prueba autenticación; la segunda envía un mensaje de prueba.
Una aceptación SMTP no garantiza llegada a la bandeja: verificar el buzón y spam.
No usar el script para cambiar contraseñas de usuarios reales.

## Producción

Crear el secreto `SMTP_PASSWORD` en Google Secret Manager del proyecto
`itc-developer-502721`, con la contraseña real del buzón como valor.
El workflow comprueba acceso al secreto sin mostrar su contenido. La cuenta de
GitHub solo necesita leerlo, no crear secretos ni añadir versiones.
El servicio de Cloud Run debe tener permiso para acceder al secreto.
El despliegue incluye host, puerto, usuario y remitente; la contraseña se inyecta
desde Secret Manager. No se requiere una nueva versión de la app.

Después del despliegue, usar una cuenta de prueba activa: solicitar el código
desde «Olvidé mi contraseña», revisar recepción, confirmar una contraseña nueva
y comprobar el inicio de sesión. El código ya utilizado debe rechazarse.
