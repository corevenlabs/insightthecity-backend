-- Remove only the two retired demo IDs. Never remove customer relationships or QR history.
DO $$
DECLARE
  retired_ids text[] := ARRAY['liberty-state-park-sunset', 'hoboken-food-discount'];
  removed_count integer;
BEGIN
  -- Fail safely rather than cascading into any real partner or redemption records.
  IF EXISTS (SELECT 1 FROM partner_clients WHERE experience_id = ANY(retired_ids))
     OR EXISTS (SELECT 1 FROM experience_drafts WHERE experience_id = ANY(retired_ids))
     OR EXISTS (SELECT 1 FROM benefit_redemptions WHERE experience_id = ANY(retired_ids)) THEN
    RAISE EXCEPTION 'Retired samples have related partner, draft or QR records; manual review required';
  END IF;
  DELETE FROM experiences WHERE id = ANY(retired_ids);
  GET DIAGNOSTICS removed_count = ROW_COUNT;
  RAISE NOTICE 'Retired demo cleanup: removed % records; remaining %', removed_count,
    (SELECT COUNT(*) FROM experiences WHERE id = ANY(retired_ids));
END $$;
