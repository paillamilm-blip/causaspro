-- ============================================================
-- CAUSASPRO - Semáforo de urgencia rediseñado para causas de PROTECCIÓN
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================
--
-- PROBLEMA que resuelve:
-- El semáforo anterior solo marcaba urgencia por AUDIENCIAS FUTURAS (fecha >= NOW()).
-- Pero las causas de protección casi nunca tienen audiencia futura agendada: su
-- historial de audiencias es todo PASADO. Resultado: TODO salía "Estable" (0 alertas),
-- inútil para decidir.
--
-- Además, "dias_sin_actividad" usaba updated_at, que se actualiza CADA VEZ que el bot
-- toca la causa → una causa recién scrapeada parecía "activa" aunque su último trámite
-- real fuera de hace años. Ahora la actividad se mide por la FECHA DEL ÚLTIMO MOVIMIENTO
-- REAL del portal (fecha_ultimo_movimiento), no por cuándo corrió el bot.
--
-- NUEVO SEMÁFORO (multi-señal, pensado para protección):
--   1 CRÍTICA  (rojo)    : traslado al curador ≤30d | audiencia futura ≤2d | medida ≤7d
--   2 CRÍTICA  (rojo)    : (medida cautelar por vencer)
--   3 ATENCIÓN (amarillo): audiencia futura ≤7d | MOVIMIENTO NUEVO ≤7d (novedad que revisar)
--   4 ATENCIÓN (amarillo): traslado al curador antiguo (>30d)
--   6 REVISAR  (naranjo) : SIN MOVIMIENTO REAL hace >90d (causa estancada, activa)
--   10 ESTABLE (verde)   : con actividad reciente normal
--
-- El Dashboard mapea: nivel<=2 Críticas, 3-4 Atención, 5-6 Revisar, >6 Estables.
-- Aditivo: solo recrea la vista. No toca tablas ni datos.
-- ============================================================

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
    -- ACTIVIDAD REAL: días desde el último MOVIMIENTO del portal (no updated_at del bot).
    -- Si la causa no tiene movimientos scrapeados aún, este valor es NULL (no se puede
    -- afirmar que esté estancada — simplemente no la hemos revisado con el bot).
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
        --   Requiere que tenga al menos un movimiento (si no, no sabemos su actividad real)
        --   y que no esté archivada/terminada.
        WHEN (SELECT MAX(m.fecha) FROM movimientos m WHERE m.causa_id = c.id) IS NOT NULL
             AND (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(m.fecha))) / 86400.0 FROM movimientos m WHERE m.causa_id = c.id) > 90
             AND (c.estado IS NULL OR (c.estado NOT ILIKE '%archiv%' AND c.estado NOT ILIKE '%termin%' AND c.estado NOT ILIKE '%cumpl%' AND c.estado NOT ILIKE '%sobresei%' AND c.estado NOT ILIKE '%fallada%'))
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
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id
              AND m.fecha >= CURRENT_DATE - INTERVAL '7 days')
        THEN 3
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE)
        THEN 4
        WHEN (SELECT MAX(m.fecha) FROM movimientos m WHERE m.causa_id = c.id) IS NOT NULL
             AND (SELECT EXTRACT(EPOCH FROM (NOW() - MAX(m.fecha))) / 86400.0 FROM movimientos m WHERE m.causa_id = c.id) > 90
             AND (c.estado IS NULL OR (c.estado NOT ILIKE '%archiv%' AND c.estado NOT ILIKE '%termin%' AND c.estado NOT ILIKE '%cumpl%' AND c.estado NOT ILIKE '%sobresei%' AND c.estado NOT ILIKE '%fallada%'))
        THEN 6
        ELSE 10
    END ASC,
    -- Desempate: dentro del mismo nivel, la de movimiento más reciente primero.
    (SELECT MAX(m.fecha) FROM movimientos m WHERE m.causa_id = c.id) DESC NULLS LAST,
    c.updated_at DESC;

-- ✅ Listo. Verificar la distribución con:
--   SELECT nivel_urgencia, COUNT(*) FROM v_causas_ranking GROUP BY nivel_urgencia ORDER BY nivel_urgencia;
