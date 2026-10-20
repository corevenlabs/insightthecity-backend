-- Permiso explícito para enviar datos del chat a OpenAI (App Store 5.1.2(i)).
-- users guarda el estado vigente; ai_consent_events es la evidencia de cada
-- aceptación o retiro, con el texto exacto mostrado en ese momento.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_consent_version INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_consent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ai_consent_events (
  id             BIGSERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_reference TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('granted', 'revoked')),
  version        INTEGER NOT NULL,
  language       TEXT NOT NULL,
  notice         JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_consent_events_user ON ai_consent_events (user_id, created_at DESC);
