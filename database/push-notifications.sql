-- Push notifications (phase 1: account and membership notices).
-- A device token belongs to the account currently signed in on that device.
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY CHECK (length(token) <= 200),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios','android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_tokens_user ON push_tokens(user_id);

-- Account and membership notices are on by default; the user can turn them off in the app.
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_account_notices BOOLEAN NOT NULL DEFAULT TRUE;

-- Outbox: one row per notice. dedupe_key makes webhook retries and duplicate events harmless.
CREATE TABLE IF NOT EXISTS push_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(40) NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS push_messages_pending ON push_messages(next_attempt_at) WHERE status = 'pending';

-- Expo tickets, checked later for receipts so dead tokens are removed.
CREATE TABLE IF NOT EXISTS push_tickets (
  id TEXT PRIMARY KEY,
  message_id UUID REFERENCES push_messages(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS push_tickets_unchecked ON push_tickets(created_at) WHERE checked_at IS NULL;
