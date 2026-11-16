BEGIN;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS private_benefit_code VARCHAR(120);
-- Move legacy code-only benefit labels into the private field. Preserve actual URLs/coupons.
UPDATE experiences SET
 private_benefit_code=COALESCE(NULLIF(BTRIM(private_benefit_code),''),(regexp_match(member_benefit,'^[[:space:]]*(?:COD|CÓDIGO|CODIGO|CODE)[[:space:]]*:[[:space:]]*([A-Za-z0-9_-]{3,80})[[:space:]]*$','i'))[1]),
 member_benefit='Beneficio exclusivo para miembros ITC Club'
WHERE access='premium' AND benefit_action='external'
 AND member_benefit ~* '^[[:space:]]*(?:COD|CÓDIGO|CODIGO|CODE)[[:space:]]*:[[:space:]]*[A-Za-z0-9_-]{3,80}[[:space:]]*$';
-- Historic offers can also contain an explicitly marked code in their conditions.
UPDATE experiences SET private_benefit_code=(regexp_match(member_benefit_details,'(?:código|codigo|code)[[:space:]]+\*\*([A-Za-z0-9_-]{3,80})\*\*','i'))[1]
WHERE access='premium' AND benefit_action='external'
 AND NULLIF(BTRIM(private_benefit_code),'') IS NULL
 AND member_benefit_details ~* '(?:código|codigo|code)[[:space:]]+\*\*([A-Za-z0-9_-]{3,80})\*\*';
COMMIT;
