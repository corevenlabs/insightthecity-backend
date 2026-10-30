-- Separate editorial placement from access and Top de hoy.
-- Only the first application preserves the previously visible recommendations.
-- Subsequent deploys never reselect items an administrator has switched off.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'experiences'
      AND column_name = 'is_itc_recommended'
  ) THEN
    ALTER TABLE experiences ADD COLUMN is_itc_recommended boolean NOT NULL DEFAULT false;
    UPDATE experiences SET is_itc_recommended = true
    WHERE is_published = true AND access = 'free'
      AND COALESCE(section, '') NOT IN ('guias', 'guides')
      AND (section = 'top_today' OR NOT EXISTS (
        SELECT 1 FROM experiences
        WHERE is_published = true AND access = 'free' AND section = 'top_today'
      ));
  END IF;
END $$;
