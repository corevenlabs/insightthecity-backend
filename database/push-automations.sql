-- Push notifications phase 3: automatic notices about content.

-- Reminders about experiences the person saved (on by default; they only start once an admin enables them in the panel).
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_saved_reminders BOOLEAN NOT NULL DEFAULT TRUE;

-- Server copy of the experiences each person saved in the app. The app stays the source of truth;
-- this mirror is only used to send reminders.
CREATE TABLE IF NOT EXISTS saved_experiences (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  experience_id VARCHAR(120) NOT NULL REFERENCES experiences(id) ON DELETE CASCADE ON UPDATE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, experience_id)
);
CREATE INDEX IF NOT EXISTS saved_experiences_experience ON saved_experiences(experience_id);

-- When an experience first became visible in the app (used by the new-experiences summary).
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
UPDATE experiences SET published_at = created_at WHERE is_published AND published_at IS NULL;
CREATE OR REPLACE FUNCTION set_experience_published_at() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_published AND NEW.published_at IS NULL THEN NEW.published_at := NOW(); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_experiences_published_at ON experiences;
CREATE TRIGGER trg_experiences_published_at BEFORE INSERT OR UPDATE OF is_published ON experiences
  FOR EACH ROW EXECUTE FUNCTION set_experience_published_at();

-- Notices about one experience carry it so the copy and the validity check can use it.
ALTER TABLE push_messages ADD COLUMN IF NOT EXISTS experience_id VARCHAR(120) REFERENCES experiences(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- Campaigns created by an automation instead of a person.
ALTER TABLE push_campaigns ADD COLUMN IF NOT EXISTS automation VARCHAR(30);
CREATE UNIQUE INDEX IF NOT EXISTS push_campaigns_automation_day ON push_campaigns(automation, ((created_at AT TIME ZONE 'America/New_York')::date)) WHERE automation IS NOT NULL;

-- Automations are off until an administrator turns them on in the panel.
CREATE TABLE IF NOT EXISTS push_automations (
  kind VARCHAR(30) PRIMARY KEY CHECK (kind IN ('saved_reminders','new_experiences')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO push_automations(kind) VALUES ('saved_reminders'), ('new_experiences') ON CONFLICT DO NOTHING;
