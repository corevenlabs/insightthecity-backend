-- Per-person push history is deleted after 90 days; finished campaigns keep only anonymous totals.
ALTER TABLE push_campaigns ADD COLUMN IF NOT EXISTS final_stats JSONB;
ALTER TABLE push_campaigns ADD COLUMN IF NOT EXISTS final_opens INTEGER;
