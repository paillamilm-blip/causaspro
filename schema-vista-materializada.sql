-- CAUSASPRO - Vista MATERIALIZADA del semáforo (solución definitiva al timeout)
-- Ejecutar en: SQL Editor de Supabase (proyecto de datos real)
-- ============================================================
--
-- PROBLEMA que resuelve (definitivamente):
-- La vista v_causas_ranking hace ~20 subqueries correlacionados por fila. Aún con
-- índices, el EXPLAIN ANALYZE mostró ~5900 ms de ejecución -> supera el
-- statement_timeout del rol anon -> el dashboard cae al fallback "todo Estable"
-- (error 57014). Confirmado en consola de producción.
--
-- SOLUCIÓN: precalcular el semáforo en una VISTA MATERIALIZADA (tabla física).
-- El dashboard lee esa tabla ya calculada -> milisegundos, IMPOSIBLE que supere el
-- timeout. Se refresca tras cada corrida del bot (o manualmente / por cron).
--
-- CÓMO FUNCIONA sin tocar el frontend:
--   1. mv_causas_ranking = MATERIALIZED VIEW con TODO el cálculo del semáforo.
--   2. índice único en id -> permite REFRESH ... CONCURRENTLY (sin bloquear lecturas).
--   3. v_causas_ranking pasa a ser una vista simple: SELECT * FROM mv_causas_ranking
--      (ya ordenada). El frontend sigue consultando "v_causas_ranking" igual, pero
--      ahora es instantáneo.
--
-- REFRESCAR los datos (después de que el bot carga movimientos/audiencias):
--   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_causas_ranking;
--   (o vía el endpoint POST /api/ranking/refresh con token)
--
-- Aditivo: no toca tablas de datos. Reemplaza solo la vista v_causas_ranking.
-- ============================================================

DROP VIEW IF EXISTS v_causas_ranking CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_causas_ranking CASCADE;

CREATE MATERIALIZED VIEW mv_causas_ranking AS
SELECT 
    c.id, c.rit, c.rol, c.anio, c.caratulado, c.tipo, c.estado, c.programa_vigente,
    c.sintesis, c.notas, c.fecha_apertura, c.fecha_notificacion, c.updated_at,
    (SELECT COUNT(*) FROM nna n WHERE n.causa_id = c.id) AS total_nna,
    (SELECT string_agg(COALESCE(n.nombre,'') || ' ' || COALESCE(n.apellido,''), ' | ') FROM nna n WHERE n.causa_id = c.id) AS nombres_nna,
    (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) AS proxima_audiencia,
    (SELECT EXTRACT(EPOCH FROM (MIN(a.fecha) - NOW())) / 86400.0 FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) AS dias_para_audiencia,
    (SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id) AS ultima_audiencia,
    (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(m.fecha))) / 86400.0
     FROM movimientos m WHERE m.causa_id = c.id) AS dias_sin_actividad,
    (SELECT MIN(mc.fecha_vencimiento) FROM medidas_cautelares mc WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) AS proxima_medida_vence,
    (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) AS dias_medida_vence,
    (SELECT COUNT(*) > 0 FROM medidas_cautelares mc WHERE mc.causa_id = c.id AND mc.vigente = TRUE) AS tiene_medida_vigente,
    (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE) AS tiene_traslado_curador,
    (SELECT ad.nombre FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_nombre,
    (SELECT ad.telefono FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_telefono,
    (SELECT m.tramite FROM movimientos m WHERE m.causa_id = c.id ORDER BY m.fecha DESC LIMIT 1) AS ultimo_movimiento,
    (SELECT m.fecha FROM movimientos m WHERE m.causa_id = c.id ORDER BY m.fecha DESC LIMIT 1) AS fecha_ultimo_movimiento,
    CASE
        -- 1 CRÍTICA: traslado al curador reciente (≤30 días)
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE
              AND m.fecha >= CURRENT_DATE - INTERVAL '30 days')
        THEN 1
        -- 1 CRÍTICA: audiencia futura en ≤2 días
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 2
        THEN 1
        -- 2 CRÍTICA: medida cautelar por vencer ≤7 días
        WHEN (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) <= 7
        THEN 2
        -- 3 ATENCIÓN: audiencia futura en ≤7 días
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 7
        THEN 3
        -- 3 ATENCIÓN: MOVIMIENTO NUEVO en los últimos 7 días (novedad que revisar).
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id
              AND m.fecha >= CURRENT_DATE - INTERVAL '7 days')
        THEN 3
        -- 4 ATENCIÓN: traslado al curador antiguo (>30 días, aún relevante)
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE)
        THEN 4
        -- 6 REVISAR: causa ACTIVA sin movimiento real hace más de 90 días (estancada).
        WHEN (SELECT MAX(m.fecha) FROM movimientos m WHERE m.causa_id = c.id) IS NOT NULL
             AND (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(m.fecha))) / 86400.0 FROM movimientos m WHERE m.causa_id = c.id) > 90
             AND (c.estado IS NULL OR (c.estado NOT ILIKE '%archiv%' AND c.estado NOT ILIKE '%termin%' AND c.estado NOT ILIKE '%cumpl%' AND c.estado NOT ILIKE '%sobresei%' AND c.estado NOT ILIKE '%fallada%'))
        THEN 6
        ELSE 10
    END AS nivel_urgencia
FROM causas c;

-- Índice ÚNICO en id: obligatorio para REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_causas_ranking_id ON mv_causas_ranking(id);
-- Índice por nivel_urgencia para que el ORDER BY del semáforo sea rápido al leer.
CREATE INDEX IF NOT EXISTS idx_mv_causas_ranking_nivel ON mv_causas_ranking(nivel_urgencia);

-- La vista pública que consume el frontend: ahora lee la tabla ya calculada (instantáneo),
-- ordenada por urgencia (más urgente primero) con desempate total por id.
CREATE VIEW v_causas_ranking AS
SELECT * FROM mv_causas_ranking
ORDER BY nivel_urgencia ASC, fecha_ultimo_movimiento DESC NULLS LAST, updated_at DESC, id ASC;

-- Función RPC para refrescar desde el backend (endpoint POST /api/ranking/refresh).
-- SECURITY DEFINER: corre con permisos del dueño, así el service_role puede invocarla.
CREATE OR REPLACE FUNCTION refresh_ranking()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_causas_ranking;
END;
$$;

-- Primer llenado de la materializada.
REFRESH MATERIALIZED VIEW mv_causas_ranking;

-- ✅ Verificar (debe ser rapidísimo ahora):
--   EXPLAIN ANALYZE SELECT * FROM v_causas_ranking;   -- Execution Time < 50 ms
--   SELECT nivel_urgencia, COUNT(*) FROM v_causas_ranking GROUP BY nivel_urgencia ORDER BY 1;
