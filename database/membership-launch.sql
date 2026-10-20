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
ALTER TABLE membership_launch_invitations ADD COLUMN IF NOT EXISTS livemode BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_billing_source TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE IF EXISTS account_deletions ADD COLUMN IF NOT EXISTS stripe_billing_source TEXT NOT NULL DEFAULT 'normal';
UPDATE users SET stripe_billing_source='campaign' WHERE id IN (SELECT user_id FROM membership_launch_invitations WHERE user_id IS NOT NULL AND (setup_intent_id IS NOT NULL OR checkout_id IS NOT NULL OR subscription_id IS NOT NULL));
ALTER TABLE membership_launch_invitations ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ;
COMMIT;
