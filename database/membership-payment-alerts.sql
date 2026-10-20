CREATE TABLE IF NOT EXISTS membership_payment_alerts (
 id BIGSERIAL PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 invoice_id TEXT NOT NULL,
 billing_source TEXT NOT NULL CHECK(billing_source IN ('normal','campaign')),
 kind TEXT NOT NULL CHECK(kind IN ('failed','action_required')),
 attempts INTEGER NOT NULL DEFAULT 0,
 retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 claimed_at TIMESTAMPTZ,
 sent_at TIMESTAMPTZ,
 resolved_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(invoice_id,billing_source)
);
CREATE INDEX IF NOT EXISTS membership_payment_alerts_pending ON membership_payment_alerts(retry_at) WHERE sent_at IS NULL AND resolved_at IS NULL;
