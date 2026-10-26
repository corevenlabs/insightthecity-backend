-- Optional fields: existing experiences keep their content and publication state.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS tiktok_url TEXT;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS facebook_url TEXT;
