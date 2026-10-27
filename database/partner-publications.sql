ALTER TABLE experience_drafts ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES partner_clients(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS experience_drafts_client ON experience_drafts(client_id) WHERE client_id IS NOT NULL;
