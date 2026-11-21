-- Push notifications phase 2: campaigns written and sent from the panel.
-- Promotional pushes need their own opt-in (Apple guideline 4.5.4). It stays off until the user turns it on in the app.
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_promotions BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_promotions_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS push_campaigns (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  -- {"es":{"title":"...","body":"..."},"en":{...},"pt":{...}}; Spanish is required, the rest fall back to it.
  copy JSONB NOT NULL,
  url TEXT NOT NULL,
  audience VARCHAR(10) NOT NULL DEFAULT 'all' CHECK (audience IN ('all','members','free')),
  language VARCHAR(3) NOT NULL DEFAULT 'all' CHECK (language IN ('all','es','en','pt')),
  status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','canceled')),
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  recipients INTEGER,
  created_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  scheduled_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_campaigns_due ON push_campaigns(scheduled_at) WHERE status IN ('scheduled','sending');

-- Each recipient of a campaign is one row in the existing outbox.
ALTER TABLE push_messages ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES push_campaigns(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS push_messages_campaign ON push_messages(campaign_id, status) WHERE campaign_id IS NOT NULL;

-- One open per person and campaign, reported by the app when the notification is tapped.
CREATE TABLE IF NOT EXISTS push_campaign_opens (
  campaign_id INTEGER NOT NULL REFERENCES push_campaigns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, user_id)
);
