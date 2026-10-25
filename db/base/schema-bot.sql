-- ============================================================
-- CAUSASPRO BOT - Tablas adicionales para el bot PJUD
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================

-- ============================================================
-- MOVIMIENTOS (datos extraídos del portal PJUD)
-- ============================================================
CREATE TABLE IF NOT EXISTS movimientos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    causa_id UUID NOT NULL REFERENCES causas(id) ON DELETE CASCADE,
    fecha DATE,
    etapa TEXT,
    tramite TEXT NOT NULL,
    descripcion TEXT,
    es_traslado_curador BOOLEAN DEFAULT FALSE,
    fuente TEXT DEFAULT 'pjud_bot',  -- 'pjud_bot', 'manual', 'email'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movimientos_causa ON movimientos(causa_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_traslado ON movimientos(es_traslado_curador) WHERE es_traslado_curador = TRUE;

-- ============================================================
-- BOT_LOGS (log por causa scrapeada)
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    causa_id UUID REFERENCES causas(id) ON DELETE SET NULL,
    rit TEXT,
    fecha_scraping TIMESTAMPTZ DEFAULT NOW(),
    movimientos_encontrados INT DEFAULT 0,
    audiencias_encontradas INT DEFAULT 0,
    resoluciones_encontradas INT DEFAULT 0,
    tiene_traslado_curador BOOLEAN DEFAULT FALSE,
    nivel_urgencia INT,
    motivos TEXT[],
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_logs_causa ON bot_logs(causa_id);
CREATE INDEX IF NOT EXISTS idx_bot_logs_fecha ON bot_logs(fecha_scraping DESC);

-- ============================================================
-- BOT_RUNS (log por sesión de ejecución)
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id TEXT UNIQUE,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    total_causas INT DEFAULT 0,
    procesadas INT DEFAULT 0,
    exitosas INT DEFAULT 0,
    fallidas INT DEFAULT 0,
    detenido_por TEXT,  -- 'completado', 'limite_sesion', 'error_critico', 'captcha', 'bloqueado'
    errores TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_runs_fecha ON bot_runs(started_at DESC);

-- ============================================================
-- Deshabilitar RLS para las tablas del bot
-- ============================================================
ALTER TABLE movimientos DISABLE ROW LEVEL SECURITY;
ALTER TABLE bot_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE bot_runs DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- ACTUALIZAR VISTA v_causas_ranking para incluir movimientos
-- Ahora también detecta TRASLADO AL CURADOR desde la tabla movimientos
-- ============================================================
DROP VIEW IF EXISTS v_causas_ranking CASCADE;

CREATE OR REPLACE VIEW v_causas_ranking AS
SELECT 
    c.id, c.rit, c.caratulado, c.tipo, c.estado, c.programa_vigente,
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
    -- NUEVO: detecta TRASLADO AL CURADOR desde movimientos del bot
    (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE) AS tiene_traslado_curador,
    (SELECT ad.nombre FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_nombre,
    (SELECT ad.telefono FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_telefono,
    -- Último movimiento del bot
    (SELECT m.tramite FROM movimientos m WHERE m.causa_id = c.id ORDER BY m.fecha DESC LIMIT 1) AS ultimo_movimiento,
    (SELECT m.fecha FROM movimientos m WHERE m.causa_id = c.id ORDER BY m.fecha DESC LIMIT 1) AS fecha_ultimo_movimiento,
    -- NIVEL DE URGENCIA MEJORADO (incluye TRASLADO AL CURADOR)
    CASE
        -- MÁXIMA: TRASLADO AL CURADOR detectado (reciente, últimos 30 días)
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE 
              AND m.fecha >= CURRENT_DATE - INTERVAL '30 days')
        THEN 1
        -- Audiencia en ≤2 días
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 2
        THEN 1
        -- Medida cautelar vence ≤7 días
        WHEN (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) <= 7
        THEN 2
        -- Audiencia ≤7 días
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 7
        THEN 3
        -- TRASLADO AL CURADOR antiguo (>30 días)
        WHEN (SELECT COUNT(*) > 0 FROM movimientos m WHERE m.causa_id = c.id AND m.es_traslado_curador = TRUE)
        THEN 4
        -- Sin actividad >30 días
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(c.updated_at, COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)))) / 86400.0 > 30
        THEN 4
        -- Sin actividad >15 días
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(c.updated_at, COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)))) / 86400.0 > 15
        THEN 5
        -- Sin audiencia programada (causa activa)
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

-- ✅ LISTO - Tablas del bot creadas y vista actualizada
