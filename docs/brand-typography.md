# Tipografía de ITC

Dos funciones visuales, con archivos de fuente concretos y compartidos:

- **Banners:** Roboto Condensed Black (900), siguiendo el estilo pesado y compacto de la referencia. El nombre es la fuente elegida para unificar, no una identificación probada de la imagen original.
- **Lectura e interfaz:** Roboto Regular (400) para párrafos; Medium/SemiBold para etiquetas; Bold/ExtraBold/Black para títulos y énfasis. No mezclar familias según pantalla.
- **Logo y distintivos oficiales:** conservar las imágenes originales; no sustituir sus letras por una fuente.

## App

`src/components/typography` proporciona Text y TextInput con las familias cargadas por Expo. Conserva referencias a inputs, texto anidado, peso, cursiva, accesibilidad y tamaño del sistema. Usar `variant="banner"` en los mensajes de banners; el resto usa la familia de lectura. No importar Text/TextInput directamente desde React Native fuera del componente base. Los iconos conservan sus fuentes propias.

La tipografía del contenido de noticias dentro del WebView se obtiene de los mismos archivos del backend. Los diálogos nativos del sistema y las pantallas externas de Stripe pertenecen a sus proveedores.

## Páginas y panel

Las fuentes están alojadas en el propio proyecto, con sus licencias. Las páginas HTML del backend reciben la hoja `/brand-assets/typography.css` mediante middleware, manteniendo una CSP restrictiva con fuentes del mismo origen. El panel usa la misma familia y archivos en `/brand/typography.css`.

## Correos

El transporte único aplica `services/brand-typography.email` a todos los HTML, incluidos mensajes que antes solo tenían texto (códigos de recuperación). Se conservan asunto y texto originales. Todos los elementos de texto, tablas y botones reciben Arial/Helvetica/sans-serif directamente en sus estilos, además de la regla compartida del encabezado, para mantener coherencia cuando el lector elimina esa regla. La familia elegida no depende de descargar fuentes externas. Los banners PNG conservan la tipografía incorporada en la imagen.

Los banners se renderizan como PNG con la fuente condensada incorporada visualmente. Así la letra no depende del cliente de correo. `scripts/render-email-banners.cjs` vuelve a generar toda la familia con una única fuente, manteniendo los mensajes. Ejecutar con Playwright instalado y configurar `CHROME_PATH` si corresponde.

## Despliegue

Al publicar esta versión, desplegar primero el backend para que estén disponibles fuentes y banners, y luego panel y actualización OTA de la app. No cambian mensajes, precios, renovaciones, autenticación ni las reglas de activación.

## Banners de correo aprobados · 19 de octubre de 2026

Todos los banners activos de invitación, creación de cuenta, prueba gratis,
bienvenida, cancelación, reactivación y socios usan **Roboto Condensed Black
(900)** desde `public/brand/fonts/RobotoCondensed_900Black.ttf`.
Los subtítulos usan también Roboto Condensed Black (900). Los títulos HTML usan la misma familia mediante una fuente alojada en el backend, con respaldo Arial/Helvetica cuando el lector bloquea fuentes web. Los banners no utilizan Impact ni Arial Narrow.
La fuente queda incorporada visualmente en los PNG, conservando la misma
apariencia aunque el lector de correo bloquee fuentes externas.

Regenerar con `NODE_PATH=<directorio de dependencias> node scripts/render-email-banners.cjs`.
El renderizador comprueba el área de texto de cada banner y genera una lámina
con los 16 banners en `../output/tipografia-correos/banners-roboto-condensed.png`.
Los logos y distintivos oficiales conservan sus imágenes originales.
