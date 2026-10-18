BEGIN;
CREATE TABLE IF NOT EXISTS membership_launch_invitations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email_hash TEXT NOT NULL UNIQUE,
 token_hash TEXT NOT NULL UNIQUE, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '30 days',
 checkout_id TEXT UNIQUE, subscription_id TEXT UNIQUE, activated_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE membership_launch_invitations ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;
ALTER TABLE membership_launch_invitations ADD COLUMN IF NOT EXISTS account_email_sent_at TIMESTAMPTZ;
ALTER TABLE membership_launch_invitations ADD COLUMN IF NOT EXISTS setup_intent_id TEXT UNIQUE;
ALTER TABLE membership_launch_invitations ADD COLUMN IF NOT EXISTS welcome_resend_after TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_confirmation_claimed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_confirmation_retry_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_confirmation_attempts INTEGER NOT NULL DEFAULT 0;
COMMIT;
