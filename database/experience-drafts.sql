CREATE TABLE IF NOT EXISTS experience_drafts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
 payload JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved')),
 review_note TEXT NOT NULL DEFAULT '',
 review_version INTEGER NOT NULL DEFAULT 0,
 experience_id TEXT REFERENCES experiences(id) ON DELETE SET NULL,
 reviewed_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS experience_drafts_owner_status ON experience_drafts(owner_id,status);
