-- ============================================================
-- CAUSASPRO - Ampliar CHECK del campo `tipo` en la tabla `causas`
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================
--
-- CONTEXTO:
-- El CHECK original solo permitía tipo IN ('P','X'). Las causas de familia
-- cuyo RIT empieza con otro prefijo (C, F, V, ...) quedaban con tipo NULL,
-- perdiendo información. El bot ahora deriva el tipo desde el prefijo del RIT
-- (parseRIT), así que la BD debe aceptar esos prefijos.
--
-- Prefijos de RIT en tribunales de familia (Chile):
--   P=Protección, C=Cumplimiento, F=Ordinario/Familia, V=Violencia intrafamiliar,
--   X=Exhortos/varios, Z=Otros, T=Tutela, RIT genérico y multi-letra (ej: FA).
-- ============================================================

-- 1. Eliminar el CHECK constraint anterior (nombre autogenerado por Postgres).
--    Buscamos dinámicamente el constraint sobre `tipo` y lo eliminamos.
DO $$
DECLARE
  constraint_name_var TEXT;
BEGIN
  SELECT con.conname INTO constraint_name_var
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'causas'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%tipo%';

  IF constraint_name_var IS NOT NULL THEN
    EXECUTE format('ALTER TABLE causas DROP CONSTRAINT %I', constraint_name_var);
    RAISE NOTICE 'CHECK constraint % eliminado.', constraint_name_var;
  ELSE
    RAISE NOTICE 'No se encontró CHECK constraint previo sobre tipo (nada que eliminar).';
  END IF;
END $$;

-- 2. Agregar el nuevo CHECK ampliado (permite NULL y los prefijos conocidos).
ALTER TABLE causas
  ADD CONSTRAINT causas_tipo_check
  CHECK (tipo IS NULL OR tipo IN ('P','C','F','V','X','Z','T','FA','RIT'));

-- 3. (Opcional) Backfill: derivar tipo desde el RIT para causas que quedaron NULL.
--    Toma el prefijo de letras antes del primer guión. Solo actualiza si el
--    prefijo resultante está en la lista permitida.
UPDATE causas
SET tipo = UPPER(SUBSTRING(rit FROM '^([A-Za-z]{1,3})-'))
WHERE tipo IS NULL
  AND rit ~ '^[A-Za-z]{1,3}-'
  AND UPPER(SUBSTRING(rit FROM '^([A-Za-z]{1,3})-')) IN ('P','C','F','V','X','Z','T','FA','RIT');
