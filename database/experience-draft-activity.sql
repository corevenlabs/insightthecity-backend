CREATE TABLE IF NOT EXISTS experience_draft_activity (
 id BIGSERIAL PRIMARY KEY,
 draft_id UUID NOT NULL REFERENCES experience_drafts(id) ON DELETE CASCADE,
 actor_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
 kind TEXT NOT NULL CHECK(kind IN ('created','saved','submitted','returned','published')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS experience_draft_activity_draft ON experience_draft_activity(draft_id,id);
