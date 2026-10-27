ALTER TABLE partner_clients ADD COLUMN IF NOT EXISTS checkout_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner_clients ADD COLUMN IF NOT EXISTS stripe_partner_customer_id TEXT;
