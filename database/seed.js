require("dotenv").config();
const db = require("../config/db");
const service = require("../services/experiences.service");

// Contenido inicial (migrado desde la app: src/constants/experiences.ts).
// section: top_today | drops | que_hacer | ny_al_dia | guias | null
const experiences = [
  {
    id: "central-park-concert",
    title: "Concierto en Central Park",
    category: "EVENTO",
    image_url: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a",
    date_label: "Hoy · 7:00 PM",
    location: "Central Park, Manhattan",
    access: "free",
    section: "top_today",
    is_featured: true,
    description:
      "Una noche de música al aire libre para disfrutar el ambiente local de Nueva York. Ideal para ir con amigos, caminar por el parque y cerrar el día con una experiencia sencilla pero memorable.",
    includes: ["Acceso general al evento", "Zona de food trucks cercana", "Ambiente familiar y música en vivo"],
    recommendation: "Llega al menos 40 minutos antes para conseguir buen lugar y lleva una manta ligera.",
  },
  {
    id: "summit-nyc-2x1",
    title: "2x1 SUMMIT",
    category: "CITY DROP",
    image_url: "https://images.unsplash.com/photo-1518391846015-55a9cc003b25",
    date_label: "Disponible por 48 horas",
    location: "One Vanderbilt, Midtown Manhattan",
    access: "premium",
    section: "drops",
    is_featured: true,
    description:
      "Un beneficio por tiempo limitado para vivir una de las vistas más icónicas de Manhattan. Perfecto para fotos, atardecer y una experiencia premium sobre la ciudad.",
    includes: ["Beneficio 2x1 en entradas seleccionadas", "Acceso sujeto a disponibilidad", "Recomendaciones para mejor horario"],
    recommendation: "El atardecer suele ser el mejor momento, pero reserva temprano porque los horarios se agotan rápido.",
  },
  {
    id: "ellens-stardust-diner",
    title: "Ellen's Stardust Diner",
    category: "DESCUENTO",
    image_url: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4",
    date_label: "Hoy · Todo el día",
    location: "Times Square, Manhattan",
    access: "free",
    section: "top_today",
    is_featured: true,
    description:
      "Un clásico de Times Square con meseros cantantes, ambiente Broadway y comida americana. Una parada divertida para quienes quieren vivir algo muy neoyorquino.",
    includes: ["Beneficio aplicable en consumo", "Ambiente musical en vivo", "Recomendado para grupos y familias"],
    recommendation: "Evita horas pico si quieres esperar menos. La experiencia vale más por el show que por la comida.",
  },
  {
    id: "broadway-week",
    title: "Broadway Week",
    category: "DROP",
    image_url: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba",
    date_label: "Termina domingo",
    location: "Theater District, Manhattan",
    access: "premium",
    section: "drops",
    description:
      "Una selección de entradas con precio especial para vivir Broadway sin pagar tarifa completa. Ideal para descubrir musicales clásicos y nuevas producciones.",
    includes: ["Acceso a ofertas seleccionadas", "Guía de obras recomendadas", "Tips para elegir mejores asientos"],
    recommendation: "Si es tu primera vez, elige una obra con horario temprano para combinarla con cena cerca del teatro.",
  },
  {
    id: "rooftop-230-fifth",
    title: "230 Fifth Rooftop",
    category: "DROP",
    image_url: "https://images.unsplash.com/photo-1514565131-fce0801e5785",
    date_label: "Solo hoy",
    location: "Flatiron District, Manhattan",
    access: "premium",
    section: "drops",
    description:
      "Un rooftop con vistas al Empire State Building y ambiente perfecto para cerrar la noche. El beneficio aplica para una selección de cocktails.",
    includes: ["Beneficio en cocktails seleccionados", "Vista al skyline", "Recomendación de horario para fotos"],
    recommendation: "Ve antes de que oscurezca para aprovechar la vista y quedarte al ambiente nocturno.",
  },
  {
    id: "restaurant-week-nyc",
    title: "Restaurant Week NYC",
    category: "FOOD",
    image_url: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4",
    date_label: "Todo el mes",
    location: "Manhattan",
    access: "premium",
    section: "drops",
    description:
      "Una temporada perfecta para probar restaurantes reconocidos con menús especiales. Ideal para descubrir cocina local, reservas nuevas y experiencias gastronómicas sin improvisar.",
    includes: ["Menús especiales por temporada", "Restaurantes seleccionados", "Recomendaciones por zona"],
    recommendation: "Reserva con anticipación y revisa si el menú aplica para almuerzo, cena o ambos.",
  },
  {
    id: "jazz-night-brooklyn",
    title: "Jazz Night Brooklyn",
    category: "MÚSICA",
    image_url: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f",
    date_label: "Hoy · 9 PM",
    location: "Brooklyn",
    access: "free",
    description:
      "Una noche íntima de jazz con talento local, ambiente relajado y una vibra distinta a Manhattan. Buen plan para quienes quieren música real y una salida más local.",
    includes: ["Música en vivo", "Ambiente casual", "Opciones cercanas para cenar antes"],
    recommendation: "Llega temprano si quieres mesa cerca del escenario. Brooklyn se disfruta mejor sin prisa.",
  },
  {
    id: "moma-late-fridays",
    title: "MoMA Late Fridays",
    category: "ARTE",
    image_url: "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b",
    date_label: "Viernes",
    location: "MoMA, Midtown",
    access: "free",
    description:
      "Una oportunidad para visitar el museo en horario extendido y recorrer exhibiciones icónicas con un ambiente más tranquilo y cultural.",
    includes: ["Acceso a exhibiciones seleccionadas", "Horario extendido", "Plan ideal para tarde/noche"],
    recommendation: "Empieza por las salas principales y deja tiempo para la tienda del museo.",
  },
  {
    id: "comedy-cellar",
    title: "Comedy Cellar",
    category: "NIGHTLIFE",
    image_url: "https://images.unsplash.com/photo-1527224857830-43a7acc85260",
    date_label: "8:30 PM",
    location: "Greenwich Village",
    access: "premium",
    description:
      "Uno de los clubes de comedia más conocidos de Nueva York. Una experiencia nocturna clásica con shows íntimos, energía local y posibles invitados sorpresa.",
    includes: ["Show de comedia", "Recomendación de horarios", "Guía para combinar con cena cercana"],
    recommendation: "Confirma reglas de consumo mínimo y llega con margen porque el acceso suele ser estricto.",
  },
  {
    id: "hamilton-broadway",
    title: "Hamilton",
    category: "BROADWAY",
    image_url: "https://images.unsplash.com/photo-1503095396549-807759245b35",
    date_label: "7 PM",
    location: "Broadway",
    access: "premium",
    description:
      "Una de las producciones más populares de Broadway, con música potente, puesta en escena dinámica y una historia que se volvió referencia cultural.",
    includes: ["Información de función", "Tips para elegir asiento", "Recomendaciones antes y después del show"],
    recommendation: "Planifica llegar al distrito teatral con tiempo. Las filas y controles pueden tomar más de lo esperado.",
  },
  {
    id: "lion-king-broadway",
    title: "The Lion King",
    category: "BROADWAY",
    image_url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
    date_label: "8 PM",
    location: "Broadway",
    access: "premium",
    description:
      "Un clásico visual de Broadway con vestuario, música y escenografía pensados para sorprender a todas las edades.",
    includes: ["Información de función", "Plan familiar recomendado", "Tips para comprar con mejor horario"],
    recommendation: "Es una gran opción si viajas en familia o quieres una experiencia Broadway muy visual.",
  },
  {
    id: "brooklyn-flea",
    title: "Brooklyn Flea",
    category: "FOOD",
    image_url: "https://images.unsplash.com/photo-1488459716781-31db52582fe9",
    date_label: "Sábado",
    location: "Brooklyn",
    access: "free",
    description:
      "Mercado local con comida, vintage, diseño independiente y ambiente de fin de semana. Perfecto para caminar, probar algo distinto y encontrar piezas únicas.",
    includes: ["Entrada general", "Food vendors", "Tiendas vintage y diseño local"],
    recommendation: "Ve con efectivo/tarjeta y hambre. Lo mejor es recorrer sin apuro.",
  },
  {
    id: "rooftop-sunset-party",
    title: "Rooftop Sunset Party",
    category: "NIGHTLIFE",
    image_url: "https://images.unsplash.com/photo-1514565131-fce0801e5785",
    date_label: "6 PM",
    location: "Manhattan",
    access: "premium",
    description:
      "Un plan de tarde-noche con skyline, música y ambiente social para empezar la noche desde las alturas.",
    includes: ["Acceso sujeto a capacidad", "Ambiente rooftop", "Recomendación de hora para atardecer"],
    recommendation: "Llega antes del sunset para aprovechar la luz y evitar filas.",
  },
  {
    id: "chelsea-market-tour",
    title: "Chelsea Market Tour",
    category: "FOOD",
    image_url: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5",
    date_label: "12 PM",
    location: "Chelsea",
    access: "premium",
    description:
      "Un recorrido práctico por Chelsea Market con paradas de comida, tiendas locales y opciones para combinar con High Line.",
    includes: ["Ruta recomendada", "Paradas gastronómicas", "Plan para combinar con High Line"],
    recommendation: "Hazlo al mediodía y termina caminando hacia Little Island o Meatpacking District.",
  },
  {
    id: "museum-nights",
    title: "Museum Nights",
    category: "DROP",
    image_url: "https://images.unsplash.com/photo-1522083165195-3424ed129620",
    date_label: "Entrada gratuita",
    location: "NYC",
    access: "free",
    section: "drops",
    description:
      "Una selección de noches de museo con entrada gratuita o acceso especial. Ideal para sumar cultura al viaje sin gastar de más.",
    includes: ["Museos participantes", "Horarios recomendados", "Tips para evitar filas"],
    recommendation: "Revisa si necesitas reserva previa, incluso cuando la entrada es gratis.",
  },
  {
    id: "edge-observatory",
    title: "Edge Observatory",
    category: "DROP",
    image_url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
    date_label: "25% OFF entradas",
    location: "Hudson Yards",
    access: "premium",
    section: "drops",
    description:
      "Un beneficio para subir a uno de los observatorios más llamativos de Nueva York, con vistas abiertas hacia Manhattan y el Hudson.",
    includes: ["Descuento en entradas seleccionadas", "Tip de horario", "Guía para combinar con Hudson Yards"],
    recommendation: "Combínalo con Little Island o High Line para armar una tarde completa.",
  },
  {
    id: "ny-weekend-plans",
    title: "Planes para esta semana en Nueva York",
    category: "QUE HACER EN NY",
    image_url: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a",
    date_label: "Esta semana",
    location: "NYC",
    access: "free",
    section: "que_hacer",
    is_featured: true,
    description:
      "Una curaduría rápida de planes para moverte por la ciudad: eventos, cine al aire libre, música, mercados y experiencias locales.",
    includes: ["Lista de planes recomendados", "Ideas gratis y de bajo costo", "Zonas sugeridas para visitar"],
    recommendation: "Combina dos planes cercanos en la misma zona para aprovechar mejor el día.",
  },
  {
    id: "ny-alerts-today",
    title: "Noticias y alertas que debes saber hoy",
    category: "NUEVA YORK AL DÍA",
    image_url: "https://images.unsplash.com/photo-1522083165195-3424ed129620",
    date_label: "Actualizado hoy",
    location: "NYC/NJ",
    access: "free",
    section: "ny_al_dia",
    is_featured: true,
    description:
      "Resumen de cambios importantes en la ciudad: transporte, clima, cierres, eventos masivos y noticias útiles para residentes y visitantes.",
    includes: ["Resumen actualizado", "Alertas prácticas", "Contexto para moverte mejor"],
    recommendation: "Revísalo antes de salir, especialmente si vas a Manhattan o cruzas entre NYC y NJ.",
  },
  {
    id: "nyc-local-guides",
    title: "Guías para vivir NYC como local",
    category: "GUÍA TURÍSTICA",
    image_url: "https://images.unsplash.com/photo-1518391846015-55a9cc003b25",
    date_label: "Guía recomendada",
    location: "Nueva York",
    access: "premium",
    section: "guias",
    is_featured: true,
    description:
      "Rutas, miradores, museos, rooftops y planes seleccionados para organizar tu visita sin perder tiempo buscando entre cientos de opciones.",
    includes: ["Ruta sugerida por zonas", "Lugares para fotos", "Tips de horarios y transporte"],
    recommendation: "Úsala como base para planificar un día completo y ajusta según clima y distancia.",
  },
];

(async () => {
  try {
    await db.query("TRUNCATE experiences CASCADE");
    for (const exp of experiences) {
      await service.create(exp);
    }
    console.log(`✅ Seed completado: ${experiences.length} experiencias`);
  } catch (err) {
    console.error("❌ Error en seed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
