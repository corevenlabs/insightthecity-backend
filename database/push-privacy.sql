-- Reminders about saved experiences are off until the person turns them on.
-- The reset only touches people who never chose: this file runs on every deploy.
ALTER TABLE users ALTER COLUMN push_saved_reminders SET DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_saved_reminders_changed_at TIMESTAMPTZ;
UPDATE users SET push_saved_reminders=FALSE WHERE push_saved_reminders AND push_saved_reminders_changed_at IS NULL;

-- Proof of each opt-in and withdrawal (promotions and saved reminders). Deleted with the account.
CREATE TABLE IF NOT EXISTS push_consent_events (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preference VARCHAR(20) NOT NULL CHECK (preference IN ('promotions','saved')),
  granted BOOLEAN NOT NULL,
  -- Version of the text shown next to the switch; NULL if the app did not report it.
  text_version VARCHAR(40),
  language VARCHAR(2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_consent_events_user ON push_consent_events(user_id, created_at);
INSERT INTO push_consent_events(user_id, preference, granted, created_at)
  SELECT u.id, 'promotions', u.push_promotions, u.push_promotions_changed_at FROM users u
  WHERE u.push_promotions_changed_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM push_consent_events e WHERE e.user_id=u.id AND e.preference='promotions');

-- What is left of a membership notice after 90 days: an irreversible code that stops it from being repeated.
CREATE TABLE IF NOT EXISTS push_notice_markers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, key_hash)
);
