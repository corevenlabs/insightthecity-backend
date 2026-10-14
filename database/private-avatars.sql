CREATE TABLE IF NOT EXISTS user_avatars (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 bytes BYTEA NOT NULL,
 mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
 version UUID NOT NULL DEFAULT gen_random_uuid(),
 legacy_key TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
