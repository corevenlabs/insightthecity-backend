-- Retire the catalog without deleting historical purchase evidence or private assets.
DO $$ BEGIN
 IF to_regclass('public.guides') IS NOT NULL THEN
  UPDATE guides SET is_published=FALSE,individual_purchase_enabled=FALSE,updated_at=NOW()
  WHERE is_published OR individual_purchase_enabled;
 END IF;
END $$;
UPDATE experiences SET is_published=FALSE,updated_at=NOW()
WHERE section IN ('guias','guides') AND is_published;
