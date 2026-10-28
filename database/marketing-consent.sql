-- Existing accounts remain opted out. Only explicit new-account consent is recorded.
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_version TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_language VARCHAR(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_text TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_source TEXT;
