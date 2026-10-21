CREATE TABLE IF NOT EXISTS apple_auth_challenges (
 id TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS apple_auth_identities (
 subject TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 refresh_token_encrypted TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE apple_auth_identities ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT;
