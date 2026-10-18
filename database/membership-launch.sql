BEGIN;
CREATE TABLE IF NOT EXISTS membership_launch_invitations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email_hash TEXT NOT NULL UNIQUE,
 token_hash TEXT NOT NULL UNIQUE, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '30 days',
 checkout_id TEXT UNIQUE, subscription_id TEXT UNIQUE, activated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE membership_launch_invitations ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;
COMMIT;
