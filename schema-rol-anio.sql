-- ============================================================
-- CAUSASPRO - Identidad estable de la causa: rol (número) + anio (año)
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================
--
-- POR QUÉ:
-- Hasta ahora la causa se identificaba por `rit` (texto completo, ej. "P-4596-2024").
-- Pero la LETRA (P/X/C...) es el dato inestable: puede faltar en el Excel, venir
-- equivocada, o coexistir (una protección P y su cumplimiento X comparten número+año).
-- El identificador REALMENTE estable es número + año.
--
-- ESTE SCRIPT agrega dos columnas nuevas:
--   rol  INTEGER  → el número del RIT (ej. 4596), SIN ceros a la izquierda.
--   anio INTEGER  → el año del RIT (ej. 2024).
-- La letra sigue viviendo en `tipo`, y `rit` (texto) queda como campo de display,
-- reconstruible como (tipo ? tipo||'-' : '') || rol || '-' || anio.
--
-- Es 100% ADITIVO: no borra ni renombra columnas. El código viejo que use `rit`
-- sigue funcionando; el nuevo puede filtrar/agrupar por (rol, anio).
-- Idempotente: se puede correr más de una vez sin romper nada.
--
-- ⚠️ ORDEN DE DESPLIEGUE (IMPORTANTE):
-- CORRER ESTE SCRIPT EN SUPABASE **ANTES** de desplegar el código nuevo.
-- El INSERT del upload y las escrituras del bot (upsertCausaHermana,
-- updateCausaRitYTipo) ahora mandan las columnas rol/anio. Si el código se
-- despliega ANTES de que estas columnas existan en la BD, PostgREST rechaza
-- el INSERT/UPDATE por "columna inexistente" y se cae la carga de Excel y la
-- sincronización del bot. Secuencia segura: (1) correr este SQL, (2) mergear/deploy.
-- ============================================================

-- 1. Agregar las columnas (si no existen).
ALTER TABLE causas ADD COLUMN IF NOT EXISTS rol  INTEGER;
ALTER TABLE causas ADD COLUMN IF NOT EXISTS anio INTEGER;

-- 2. Backfill: derivar rol y anio del `rit` existente para TODAS las causas.
--    El rit puede venir con letra ("P-4596-2024") o sin letra ("4596-2024").
--    Tomamos el ÚLTIMO bloque numérico como año y el bloque numérico previo como rol.
--    Regex:
--      rol : primer grupo de dígitos que va seguido de "-<año de 4 dígitos>" al final.
--      anio: los 4 dígitos finales.
--    Solo actualiza filas donde el rit calza el patrón número-año (con o sin letra).
UPDATE causas
SET
  rol  = CAST(SUBSTRING(rit FROM '(\d+)-\d{4}$') AS INTEGER),
  anio = CAST(SUBSTRING(rit FROM '(\d{4})$')     AS INTEGER)
WHERE rit ~ '\d+-\d{4}$'
  AND (rol IS NULL OR anio IS NULL);

-- 3. Índice por (rol, anio) — el nuevo eje de búsqueda/agrupación.
--    NO es único: una protección P y su cumplimiento X comparten (rol, anio) a propósito.
CREATE INDEX IF NOT EXISTS idx_causas_rol_anio ON causas(rol, anio);

-- 4. Recrear la vista de ranking exponiendo rol y anio (además de rit/tipo).
--    IMPORTANTE: se parte de la versión VIGENTE de la vista (la de schema-bot.sql, que
--    incluye el criterio de TRASLADO AL CURADOR desde `movimientos` y los campos
--    ultimo_movimiento/fecha_ultimo_movimiento/tiene_traslado_curador que el Dashboard
--    consume). Solo se AGREGAN c.rol y c.anio. NO se degrada la lógica de urgencia.
DROP VIEW IF EXISTS v_causas_ranking CASCADE;

CREATE OR REPLACE VIEW v_causas_ranking AS
SELECT 
    c.id, c.rit, c.rol, c.anio, c.caratulado, c.tipo, c.estado, c.programa_vigente,
    c.sintesis, c.notas, c.fecha_apertura, c.fecha_notificacion, c.updated_at,
    (SELECT COUNT(*) FROM nna n WHERE n.causa_id = c.id) AS total_nna,
    (SELECT string_agg(COALESCE(n.nombre,'') || ' ' || COALESCE(n.apellido,''), ' | ') FROM nna n WHERE n.causa_id = c.id) AS nombres_nna,
    (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) AS proxima_audiencia,
    (SELECT EXTRACT(EPOCH FROM (MIN(a.fecha) - NOW())) / 86400.0 FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) AS dias_para_audiencia,
    (SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id) AS ultima_audiencia,
    EXTRACT(EPOCH FROM (NOW() - GREATEST(c.updated_at, COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)))) / 86400.0 AS dias_sin_actividad,
    (SELECT MIN(mc.fecha_vencimiento) FROM medidas_cautelares mc WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) AS proxima_medida_vence,
    (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) AS dias_medida_vence,
    (SELECT COUNT(*) > 0 FROM medidas_cautelares mc WHERE mc.causa_id = c.id AND mc.vigente = TRUE) AS tiene_medida_vigente,
    -- TRASLADO AL CURADOR desde movimientos del bot (criterio de máxima urgencia)
    (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE) AS tiene_traslado_curador,
    (SELECT ad.nombre FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_nombre,
    (SELECT ad.telefono FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_telefono,
    (SELECT m.tramite FROM movimientos m WHERE m.causa_id = c.id ORDER BY m.fecha DESC LIMIT 1) AS ultimo_movimiento,
    (SELECT m.fecha FROM movimientos m WHERE m.causa_id = c.id ORDER BY m.fecha DESC LIMIT 1) AS fecha_ultimo_movimiento,
    CASE
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE 
              AND m.fecha >= CURRENT_DATE - INTERVAL '30 days')
        THEN 1
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 2
        THEN 1
        WHEN (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) <= 7
        THEN 2
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 7
        THEN 3
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE)
        THEN 4
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(c.updated_at, COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)))) / 86400.0 > 30
        THEN 4
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(c.updated_at, COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)))) / 86400.0 > 15
        THEN 5
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NULL
             AND c.estado IS NOT NULL AND c.estado NOT ILIKE '%archivada%' AND c.estado NOT ILIKE '%terminada%'
        THEN 6
        ELSE 10
    END AS nivel_urgencia
FROM causas c
ORDER BY 
    CASE
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE 
              AND m.fecha >= CURRENT_DATE - INTERVAL '30 days')
        THEN 1
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 2
        THEN 1
        WHEN (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) <= 7
        THEN 2
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 7
        THEN 3
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE)
        THEN 4
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(c.updated_at, COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)))) / 86400.0 > 30
        THEN 4
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(c.updated_at, COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)))) / 86400.0 > 15
        THEN 5
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NULL
             AND c.estado IS NOT NULL AND c.estado NOT ILIKE '%archivada%' AND c.estado NOT ILIKE '%terminada%'
        THEN 6
        ELSE 10
    END ASC,
    c.updated_at DESC;

-- ✅ Listo. Verificar con:
--   SELECT rit, rol, anio, tipo FROM causas WHERE rol IS NOT NULL LIMIT 20;
