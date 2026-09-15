-- Esquema PostgreSQL para InsightTheCity (ITC Club)
-- Ejecutar contra la base de datos ya creada:
--   psql "$DATABASE_URL" -f database/schema.sql

-- ============================================================
-- Contenido gestionable desde el panel (experiencias / drops)
-- ============================================================
CREATE TABLE IF NOT EXISTS experiences (
  id             VARCHAR(120) PRIMARY KEY,          -- slug: "central-park-concert"
  title          VARCHAR(200) NOT NULL,
  category       VARCHAR(60)  NOT NULL,             -- EVENTO, DROP, FOOD, BROADWAY, ...
  image_url      VARCHAR(500),                      -- URL pública en Cloud Storage
  date_label     VARCHAR(120),                      -- "Hoy · 7:00 PM"
  location       VARCHAR(200),
  region         VARCHAR(2) NOT NULL DEFAULT 'NY'
                 CHECK (region IN ('NY', 'NJ')),
  access         VARCHAR(10) NOT NULL DEFAULT 'free'
                 CHECK (access IN ('free', 'premium')),
  description    TEXT,
  recommendation TEXT,
  section        VARCHAR(40),                       -- top_today | drops | que_hacer | ny_al_dia | guias
  is_featured    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_published   BOOLEAN NOT NULL DEFAULT TRUE,
  ends_at        TIMESTAMPTZ,                       -- para los drops con countdown
  is_paid_event  BOOLEAN NOT NULL DEFAULT FALSE,    -- entrada vendida fuera de ITC
  ticket_url     VARCHAR(1000),                     -- enlace externo de compra
  ticket_cta     VARCHAR(80),                       -- texto futuro del botón en la app
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS is_paid_event BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS ticket_url VARCHAR(1000);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS ticket_cta VARCHAR(80);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS region VARCHAR(2) NOT NULL DEFAULT 'NY';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'experiences_region_check'
  ) THEN
    ALTER TABLE experiences
      ADD CONSTRAINT experiences_region_check CHECK (region IN ('NY', 'NJ'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_experiences_section ON experiences (section);
CREATE INDEX IF NOT EXISTS idx_experiences_published ON experiences (is_published);
CREATE INDEX IF NOT EXISTS idx_experiences_region ON experiences (region);

CREATE TABLE IF NOT EXISTS experience_includes (
  id            SERIAL PRIMARY KEY,
  experience_id VARCHAR(120) NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  item          VARCHAR(255) NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_includes_experience ON experience_includes (experience_id);

-- Muestras iniciales de Nueva Jersey para validar ambas secciones en la app.
INSERT INTO experiences
  (id, title, category, image_url, date_label, location, region, access, description,
   recommendation, section, is_featured, sort_order, is_published)
VALUES
  ('liberty-state-park-sunset', 'Atardecer en Liberty State Park', 'EVENTO',
   'https://images.unsplash.com/photo-1522083165195-3424ed129620', 'Hoy · 6:30 PM',
   'Liberty State Park, Jersey City', 'NJ', 'free',
   'Un plan al aire libre con vistas directas al skyline de Manhattan, la Estatua de la Libertad y el río Hudson.',
   'Llega antes del atardecer y revisa el regreso hacia Nueva York antes de salir.',
   'top_today', TRUE, 8, TRUE),
  ('hoboken-food-discount', 'Sabores de Hoboken', 'CITY DROP',
   'https://images.unsplash.com/photo-1555396273-367ea4eb4db5', 'Disponible esta semana',
   'Washington Street, Hoboken', 'NJ', 'premium',
   'Una selección de restaurantes y cafeterías de Hoboken con descuentos especiales para miembros de ITC Club.',
   'Cruza en PATH y combina varias paradas caminando por Washington Street.',
   'drops', FALSE, 8, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO experience_includes (experience_id, item, sort_order)
SELECT 'liberty-state-park-sunset', item, sort_order
FROM (VALUES
  ('Vista al skyline de Manhattan', 0),
  ('Acceso gratuito al parque', 1),
  ('Zona ideal para fotografías', 2)
) AS sample(item, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM experience_includes WHERE experience_id = 'liberty-state-park-sunset'
);

INSERT INTO experience_includes (experience_id, item, sort_order)
SELECT 'hoboken-food-discount', item, sort_order
FROM (VALUES
  ('Descuentos en establecimientos seleccionados', 0),
  ('Ruta gastronómica caminable', 1),
  ('Recomendaciones cerca del PATH', 2)
) AS sample(item, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM experience_includes WHERE experience_id = 'hoboken-food-discount'
);

-- Partnership destacado del home (registro único editable desde el panel).
CREATE TABLE IF NOT EXISTS featured_partnership (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  brand_name  VARCHAR(120) NOT NULL,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  image_url   VARCHAR(500),
  cta_label   VARCHAR(80),
  cta_url     VARCHAR(500),
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO featured_partnership
  (id, brand_name, title, description, image_url, cta_label, cta_url, is_published)
VALUES
  (1, 'COCA-COLA', 'Comparte la magia de Nueva York con Coca-Cola',
   'Momentos refrescantes y experiencias especiales para disfrutar la ciudad juntos.',
   'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/af/Coca-cola_bottle.jpg/1280px-Coca-cola_bottle.jpg',
   'CONOCER MÁS', 'https://www.coca-cola.com/us/en', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Admins del panel
-- ============================================================
CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Tablas existentes (chat / usuarios / favoritos) migradas a Postgres
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100),
  email         VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  is_premium    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  language      VARCHAR(2) NOT NULL DEFAULT 'es' CHECK (language IN ('es', 'en', 'pt')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para bases ya existentes donde la tabla users se creó sin estas columnas
-- (antes solo se usaba para chat/favoritos). Idempotente.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(2) NOT NULL DEFAULT 'es';

CREATE TABLE IF NOT EXISTS chat_messages (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  role       VARCHAR(20) CHECK (role IN ('user', 'assistant')),
  message    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorites (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  place_id   VARCHAR(255),
  place_name VARCHAR(255)
);

-- ============================================================
-- Trigger para mantener updated_at en experiences
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_experiences_updated_at ON experiences;
CREATE TRIGGER trg_experiences_updated_at
  BEFORE UPDATE ON experiences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_featured_partnership_updated_at ON featured_partnership;
CREATE TRIGGER trg_featured_partnership_updated_at
  BEFORE UPDATE ON featured_partnership
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Migración aditiva: conserva todas las categorías y asignaciones existentes.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
UPDATE experiences SET tags = ARRAY[category] WHERE cardinality(tags) = 0 AND category <> '';
UPDATE experiences
SET tags = ARRAY(SELECT DISTINCT tag FROM unnest(tags || ARRAY['Museo', 'Experiencia inmersiva']) AS tag)
WHERE regexp_replace(lower(title), '[^a-z0-9]', '', 'g') = 'riseny'
   OR regexp_replace(lower(id), '[^a-z0-9]', '', 'g') = 'riseny';
CREATE INDEX IF NOT EXISTS idx_experiences_tags ON experiences USING GIN(tags);

-- Campos independientes, editables desde el panel.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS member_benefit VARCHAR(200);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS member_benefit_details TEXT;

-- Conservar beneficios ya descritos en Incluye; no cambiar esos textos.
UPDATE experiences e
SET member_benefit = LEFT(COALESCE(
  (SELECT TRIM(i.item) FROM experience_includes i WHERE i.experience_id = e.id
   AND TRIM(i.item) <> '' ORDER BY i.sort_order, i.id LIMIT 1),
  'Beneficio exclusivo ITC Club'), 200)
WHERE e.access = 'premium' AND e.member_benefit IS NULL;

-- Ejemplo real tomado del contenido existente de RiseNY.
UPDATE experiences e
SET member_benefit = '20% de descuento en la entrada general',
    member_benefit_details = 'Disponible de lunes a jueves con reserva previa. Sujeto a disponibilidad.'
WHERE regexp_replace(lower(e.title), '[^a-z0-9]', '', 'g') = 'riseny'
  AND e.access = 'premium'
  AND EXISTS (SELECT 1 FROM experience_includes i WHERE i.experience_id = e.id
              AND i.item ILIKE '%20% OFF GENERAL ADMISSION%')
  AND e.member_benefit = '- ITC CLUB EXCLUSIVE'
  AND e.member_benefit_details IS NULL;

-- Las tarjetas muestran beneficio solo con autorización explícita del administrador.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS show_benefit_on_card BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS card_benefit VARCHAR(60);
