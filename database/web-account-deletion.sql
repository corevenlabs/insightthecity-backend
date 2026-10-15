CREATE TABLE IF NOT EXISTS account_deletion_challenges (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 language TEXT NOT NULL DEFAULT 'es',
 code_hash TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL,
 proof_hash TEXT UNIQUE,
 proof_expires_at TIMESTAMPTZ
);
ALTER TABLE account_deletions ADD COLUMN IF NOT EXISTS request_notice_sent_at TIMESTAMPTZ;

ALTER TABLE account_deletion_challenges ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es';
