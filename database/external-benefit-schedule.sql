BEGIN;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS external_benefit_starts_at TIMESTAMPTZ;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS external_benefit_ends_at TIMESTAMPTZ;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='experiences_external_benefit_window_check') THEN
  ALTER TABLE experiences ADD CONSTRAINT experiences_external_benefit_window_check
   CHECK(external_benefit_starts_at IS NULL OR external_benefit_ends_at IS NULL OR external_benefit_ends_at>external_benefit_starts_at);
 END IF;
END $$;
COMMIT;
