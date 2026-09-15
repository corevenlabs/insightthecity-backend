-- Campos independientes, editables desde el panel.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS member_benefit VARCHAR(200);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS member_benefit_details TEXT;

-- Conservar beneficios ya descritos en Incluye; no cambiar esos textos.
UPDATE experiences e
SET member_benefit = LEFT(COALESCE(
  (SELECT TRIM(i.item) FROM experience_includes i WHERE i.experience_id = e.id
   AND TRIM(i.item) <> '' ORDER BY i.sort_order, i.id LIMIT 1),
  'Beneficio exclusivo ITC Club'), 200)
WHERE e.access = 'premium' AND e.member_benefit IS NULL;

-- Ejemplo real tomado del contenido existente de RiseNY.
UPDATE experiences e
SET member_benefit = '20% de descuento en la entrada general',
    member_benefit_details = 'Disponible de lunes a jueves con reserva previa. Sujeto a disponibilidad.'
WHERE regexp_replace(lower(e.title), '[^a-z0-9]', '', 'g') = 'riseny'
  AND e.access = 'premium'
  AND EXISTS (SELECT 1 FROM experience_includes i WHERE i.experience_id = e.id
              AND i.item ILIKE '%20% OFF GENERAL ADMISSION%')
  AND e.member_benefit = '- ITC CLUB EXCLUSIVE'
  AND e.member_benefit_details IS NULL;
