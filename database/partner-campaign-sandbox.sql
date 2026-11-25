ALTER TABLE partner_mail ADD COLUMN IF NOT EXISTS sandbox_captured_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS partner_campaign_webhook_audit (
 event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, client_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('processed','failed')), error_code TEXT,
 attempts INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
