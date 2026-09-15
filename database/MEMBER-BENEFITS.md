# Beneficios de membresía

`db:migrate` agrega `member_benefit` y `member_benefit_details` sin modificar
las descripciones, direcciones ni los ítems de Incluye.

Los contenidos premium existentes reciben como beneficio su primer ítem de
Incluye. El administrador debe revisar ese texto desde el panel y puede indicar
un descuento, 2x1, regalo u otro beneficio, junto con condiciones opcionales.

RiseNY se usa como ejemplo: el 20% de descuento y las condiciones de lunes a
jueves se toman del contenido que ya existe en Incluye. Se inicializan una sola
vez; las migraciones posteriores conservan las ediciones del administrador.

Las nuevas altas premium requieren un beneficio. Las ediciones de versiones
anteriores del cliente que omitan los nuevos campos los conservan.

Las tarjetas usan únicamente `card_benefit` (máximo 60 caracteres, una sola línea)
cuando `show_benefit_on_card` es verdadero. Esa opción empieza desactivada en
los contenidos existentes. No se copia Incluye ni el beneficio detallado al
texto de la tarjeta. El administrador debe escribirlo y autorizar su aparición.
