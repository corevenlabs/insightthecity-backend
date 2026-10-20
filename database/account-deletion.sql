CREATE TABLE IF NOT EXISTS account_deletions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id INTEGER UNIQUE,
 email TEXT,
 language TEXT NOT NULL DEFAULT 'es',
 subscription_id TEXT,
 stripe_done BOOLEAN NOT NULL DEFAULT FALSE,
 data_done BOOLEAN NOT NULL DEFAULT FALSE,
 photos_done BOOLEAN NOT NULL DEFAULT FALSE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_error TEXT,
 alerted_at TIMESTAMPTZ,
 requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS account_deletions_pending ON account_deletions(next_attempt_at) WHERE status='pending';

ALTER TABLE account_deletions ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es';

ALTER TABLE account_deletions ADD COLUMN IF NOT EXISTS stripe_billing_source TEXT NOT NULL DEFAULT 'normal';
