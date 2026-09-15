-- Migración aditiva: conserva todas las categorías y asignaciones existentes.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
UPDATE experiences SET tags = ARRAY[category] WHERE cardinality(tags) = 0 AND category <> '';
UPDATE experiences
SET tags = ARRAY(SELECT DISTINCT tag FROM unnest(tags || ARRAY['Museo', 'Experiencia inmersiva']) AS tag)
WHERE regexp_replace(lower(title), '[^a-z0-9]', '', 'g') = 'riseny'
   OR regexp_replace(lower(id), '[^a-z0-9]', '', 'g') = 'riseny';
CREATE INDEX IF NOT EXISTS idx_experiences_tags ON experiences USING GIN(tags);
