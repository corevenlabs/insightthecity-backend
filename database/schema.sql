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
  access         VARCHAR(10) NOT NULL DEFAULT 'free'
                 CHECK (access IN ('free', 'premium')),
  description    TEXT,
  recommendation TEXT,
  section        VARCHAR(40),                       -- top_today | drops | que_hacer | ny_al_dia | guias
  is_featured    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_published   BOOLEAN NOT NULL DEFAULT TRUE,
  ends_at        TIMESTAMPTZ,                       -- para los drops con countdown
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experiences_section ON experiences (section);
CREATE INDEX IF NOT EXISTS idx_experiences_published ON experiences (is_published);

CREATE TABLE IF NOT EXISTS experience_includes (
  id            SERIAL PRIMARY KEY,
  experience_id VARCHAR(120) NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  item          VARCHAR(255) NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_includes_experience ON experience_includes (experience_id);

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
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para bases ya existentes donde la tabla users se creó sin estas columnas
-- (antes solo se usaba para chat/favoritos). Idempotente.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

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
