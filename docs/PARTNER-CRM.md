# Gestión de socios y formularios ITC CLUB

## Alcance

Todo funciona en el panel existente. La app y las membresías de sus usuarios conservan sus flujos. Un socio comercial se vincula a una experiencia Premium real: el editor sigue cargando y publicando el contenido, QR e instrucciones desde el editor existente. La activación comercial es una acción posterior, manual y confirmada.

- Administrador: todas las carteras, cuentas, roles, términos, pagos, reasignación y publicación.
- Ejecutivo: crea y gestiona sus propios clientes, revisa pagos y formularios, descarga expedientes y registra seguimientos/renovaciones. La API verifica la asignación en cada acceso.
- Editor: material para preparar/publicar contenido. No recibe importes, referencias de pago, acuerdos comerciales, notas, enlaces privados ni registro de correos. Su ZIP contiene solo el material de publicación.

Las cuentas actuales conservan el rol administrador. Revisar sus permisos después de migrar. El servidor consulta el rol y el estado de la cuenta en cada solicitud; cambiar permisos o desactivar una cuenta tiene efecto inmediato. Los JWT de la app y los del formulario no permiten entrar al panel.

## Ofertas

| Categoría         | Oferta inicial   | Pago por seis meses |
| ----------------- | ---------------- | ------------------- |
| Partner           | Regular          | USD 1,200           |
| Partner           | Founding Partner | USD 300             |
| Strategic Partner | Sin cargo        | USD 0               |

Stripe utiliza Checkout en modo **payment**, sin suscripción ni cargos recurrentes. Los precios se fijan en el servidor. No hay implementación del cargo de USD 900. Las renovaciones se registran manualmente con precio y referencia acordados.

## Configuración previa al uso real

1. Ejecutar `npm run db:migrate` con la base de datos correspondiente. La migración es idempotente.
2. Definir `PANEL_PUBLIC_URL` (panel HTTPS) y `PUBLIC_BASE_URL` (backend HTTPS). El frontend se construye con `VITE_API_URL` apuntando al mismo backend.
3. Mantener SMTP de SiteGround configurado y probado. Todos estos mensajes salen de `ITC CLUB <noreply@insightthecity.com>`. El contacto y Reply-To corresponden al ejecutivo asignado.
4. En **Equipo y permisos**, crear ejecutivos y editores. La invitación, con el mismo diseño de marca, permite establecer contraseña durante 48 horas y se utiliza una sola vez. Reenviar invalida la invitación anterior.
5. En **Términos de socios**, cargar y aprobar los textos reales de cada oferta en EN/ES/PT. No se generan ni se aprueban contratos ficticios. La invitación requiere las tres traducciones aprobadas de la oferta elegida. Cada cliente conserva una copia de las versiones enviadas; futuras ediciones no cambian lo aceptado.
6. Configurar el webhook Stripe para la misma cuenta/modo que `STRIPE_SECRET_KEY`: URL `https://<backend>/api/payment/webhook`; eventos `checkout.session.completed` y `checkout.session.async_payment_succeeded`. Guardar el secreto `whsec_...` en Secret Manager y exponerlo como `STRIPE_WEBHOOK_SECRET`. No copiarlo al frontend ni a Git. El despliegue permite seleccionar su nombre mediante la variable de repositorio `STRIPE_WEBHOOK_SECRET_NAME`. Sin webhook, la comprobación manual/retorno consulta Stripe, pero no garantiza aviso automático si el cliente abandona la página.
7. Probar con Stripe **test mode** y una casilla de prueba antes de enviar invitaciones comerciales reales.

## Operación

1. Ejecutivo crea ficha: negocio, contacto, correo, idioma, categoría/oferta, método de pago. El administrador puede asignar cualquier ejecutivo activo.
2. **Enviar invitación** toma una copia de los términos aprobados y envía el enlace privado. No hay cuenta del cliente ni contraseña. El enlace dura 90 días; **Renovar enlace y reenviar** invalida el anterior.
3. Stripe: el cliente lee y acepta el acuerdo antes de Checkout. Solo se habilita el formulario al verificar sesión, importe, moneda y pago real. Los webhooks repetidos no duplican la transición ni el correo en la cola. Un pago previo se vincula mediante su sesión `cs_...`: se verifican también correo del cliente y ausencia de asociación a otro expediente. No crea otro cobro.
4. Pago externo: el ejecutivo confirma explícitamente el ingreso e indica la referencia. Strategic Partner: acceso directo sin cobro. La aceptación del formulario también queda registrada en ambos casos.
5. Cliente completa información, horarios, fotos, logo, beneficio, condiciones y método de canje. Si es enlace externo, incluye HTTPS, instrucciones y su código promocional opcional. Si es QR, informa inventario, límite por miembro y vigencia; el editor configura esos valores en la experiencia y el sistema existente genera los QR de los usuarios.
6. Puede guardar borrador y continuar. Enviar requiere campos completos, un logo, cuatro fotos diferentes, aceptación y autorización de material. Quedan guardados documento exacto, versión, idioma, nombre, correo y fecha. El formulario queda bloqueado hasta que el ejecutivo solicite correcciones. El cliente y su ejecutivo reciben correos con la misma marca.
7. Ejecutivo revisa y puede solicitar correcciones. **Descargar expediente ZIP** entrega PDF, texto, JSON, archivos originales y comprobantes de aceptación (solo administrador/ejecutivo). No publica nada.
8. Material aprobado → editor crea o edita la experiencia con las imágenes elegidas, beneficio e instrucciones. El código promocional externo debe incluirse en las instrucciones de canje. La app admite hasta ocho fotos en la galería Premium.
9. Editor vincula el ID de una experiencia Premium publicada y confirma **Activar perfil y notificar**. Se valida galería y canje. Empiezan seis meses calendario, con ajuste correcto al último día del mes. El correo incluye una vista previa pública de la experiencia y enlace a la app.
10. El panel muestra vencimiento, días restantes, filtro de próximos 30 días, seguimiento y notas. Una persona contacta al cliente y acuerda la renovación; no hay correos de renovación, cargos, publicación ni desactivación automáticos.

## Privacidad y entrega de correos

Los documentos y las imágenes originales se guardan como archivos privados en PostgreSQL, con máximo 4 MB por archivo, 13 archivos y 40 MB por cliente. No se suben al bucket público. Los archivos requieren sesión autorizada o enlace privado habilitado. Al preparar contenido para la app, el editor carga las imágenes publicables mediante el editor existente.

El enlace lleva la credencial en el fragmento `#`, no en la ruta ni en parámetros de consulta. No registrarla en analítica. Las APIs privadas responden `Cache-Control: no-store`. CORS permite el panel existente, pero no sustituye la autorización.

Los correos se guardan en una cola durable en la misma transacción que el cambio. Se intenta enviarlos antes de finalizar la solicitud; un fallo no revierte un pago ni una presentación válida. El expediente muestra `pending/sending/sent/failed`; el ejecutivo o administrador puede reintentar. Las claves de cola evitan crear dos mensajes por el mismo evento. SMTP no ofrece garantía absoluta de entrega exactamente una vez si el proceso se interrumpe después de aceptar el mensaje y antes de guardar el resultado. `sent` significa aceptación del servidor de correo, no lectura por el destinatario.

## Validación local aislada

`npm test` ejecuta las pruebas unitarias existentes y las nuevas reglas/correos. `npm run test:crm` requiere una base PostgreSQL **local** llamada exactamente `itc_crm_test`; nunca usa producción. Aplica migraciones y vacía sus tablas de prueba.

```sh
DB_HOST=127.0.0.1 DB_PORT=55439 DB_DATABASE=itc_crm_test DB_USER=<usuario-local> npm run test:crm
```

Stripe y SMTP se simulan en la integración; no se realizan pagos ni se envían correos a clientes. Verifica permisos y asignaciones, precios, consentimiento, archivos privados, acuerdos congelados, revocación de enlaces, Checkout idempotente, activación manual y acceso del equipo.
