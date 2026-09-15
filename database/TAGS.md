# Etiquetas múltiples

Antes de iniciar la nueva versión del backend, configurar las variables DB_HOST,
DB_PORT, DB_USER, DB_PASSWORD y DB_DATABASE y ejecutar desde el backend:

```sh
npm run db:migrate:tags
```

La migración agrega `experiences.tags`, copia las categorías existentes y conserva
los demás datos. RiseNY recibe Museo y Experiencia inmersiva, conservando sus
etiquetas anteriores. No ejecutar `db:seed` para esta actualización.

El panel permite seleccionar varias etiquetas y añadir otras; el catálogo incluye
las etiquetas existentes incluso de contenidos no publicados. La API mantiene
`category` por compatibilidad con versiones anteriores de la app.

El filtro de la app une los resultados de las etiquetas seleccionadas. Las opciones
NY, NJ, Hoy, Este fin de semana y Gratis conservan su comportamiento anterior;
Gratis excluye los eventos con entrada de pago. Limpiar muestra todos los contenidos.

Verificación del backend: `node --test tests/experienceTags.test.js`.
