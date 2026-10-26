CREATE TABLE IF NOT EXISTS password_change_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_version INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  language VARCHAR(2) NOT NULL DEFAULT 'es',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  UNIQUE(user_id,session_version)
);
CREATE INDEX IF NOT EXISTS password_change_notifications_pending ON password_change_notifications(next_attempt_at) WHERE status <> 'sent';
