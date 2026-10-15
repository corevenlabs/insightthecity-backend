ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS security_rate_limits (
 key_hash TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS security_rate_limits_expiry ON security_rate_limits(reset_at);
