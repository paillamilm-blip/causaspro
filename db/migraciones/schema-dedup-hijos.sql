-- ============================================================
-- LIMPIEZA DE DUPLICADOS: nna / adultos / audiencias
-- ============================================================
-- Problema: cada vez que se re-subia el Excel, la carga volvia a insertar los
-- NNA, adultos y audiencias de las causas que YA existian, acumulando duplicados
-- (los mismos nombres/audiencias repetidos en el detalle de la causa).
--
-- Este script BORRA los duplicados dejando UNA sola fila de cada uno (la mas
-- antigua, por created_at). NO borra gestiones de curaduria (esas las registra
-- Paula a mano y no vienen del Excel).
--
-- Como correrlo: pegar TODO este archivo en el SQL Editor de Supabase y ejecutar.
-- Es seguro correrlo varias veces (si no hay duplicados, no borra nada).
--
-- Recomendacion: sacar un respaldo antes (Supabase > Database > Backups) por las dudas.
-- ============================================================

-- ------------------------------------------------------------
-- 1) NNA duplicados
--    Se considera duplicado la misma causa + nombre + apellido + rut.
--    coalesce(...,'') para que los NULL agrupen igual (dos filas con rut NULL
--    y mismo nombre cuentan como el mismo NNA).
-- ------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY causa_id,
                   coalesce(lower(trim(nombre)), ''),
                   coalesce(lower(trim(apellido)), ''),
                   coalesce(lower(trim(rut)), '')
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM nna
)
DELETE FROM nna
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ------------------------------------------------------------
-- 2) ADULTOS duplicados
--    Duplicado = misma causa + nombre + relacion + telefono.
-- ------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY causa_id,
                   coalesce(lower(trim(nombre)), ''),
                   coalesce(lower(trim(relacion)), ''),
                   coalesce(lower(trim(telefono)), '')
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM adultos
)
DELETE FROM adultos
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ------------------------------------------------------------
-- 3) AUDIENCIAS duplicadas
--    Duplicado = misma causa + fecha + tipo (mismo criterio que usa el bot).
-- ------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY causa_id,
                   fecha,
                   coalesce(lower(trim(tipo)), '')
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM audiencias
)
DELETE FROM audiencias
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ------------------------------------------------------------
-- Verificacion (opcional): cuenta cuantas filas quedan por tabla.
-- ------------------------------------------------------------
-- SELECT 'nna' AS tabla, count(*) FROM nna
-- UNION ALL SELECT 'adultos', count(*) FROM adultos
-- UNION ALL SELECT 'audiencias', count(*) FROM audiencias;
