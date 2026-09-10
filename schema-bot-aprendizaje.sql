-- ============================================================
-- CAUSASPRO BOT - Sistema de AUTO-APRENDIZAJE (modo conservador)
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================
--
-- QUÉ HACE:
-- El bot registra métricas detalladas de cada corrida (duración, velocidad,
-- reintentos, en qué PASO falla y por qué). Con eso "aprende de su propio flujo".
--
-- MODO CONSERVADOR: este esquema solo GUARDA datos y los RESUME en vistas.
-- El bot NO cambia su comportamiento automáticamente: solo registra y recomienda.
-- Tú revisas las recomendaciones y decides.
--
-- REQUISITOS PREVIOS (ejecutar antes si no lo hiciste):
--   1. schema-bot.sql            (tablas bot_logs, bot_runs, movimientos)
--   2. schema-qa-trazabilidad.sql (columnas paso, screenshot_path, run_id en bot_logs)
--
-- Todo es IDEMPOTENTE: se puede correr varias veces sin romper nada.
-- ============================================================

-- Requerido para uuid_generate_v4() en la tabla nueva (normalmente ya está por
-- schema.sql, pero lo aseguramos para que esta migración sea autosuficiente).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- 1. AMPLIAR bot_runs — métricas por SESIÓN
-- ============================================================
-- Duración real de la sesión (para saber si el bot va más lento con el tiempo)
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS duracion_ms BIGINT;
-- Velocidad: causas EXITOSAS por minuto (scraping útil real, no cuenta fallidas)
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS causas_por_min NUMERIC(6,2);
-- Tasa de éxito 0-100 (exitosas / procesadas)
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS tasa_exito NUMERIC(5,2);
-- Modo de búsqueda usado ('rit' anti-CAPTCHA | 'listado' legacy)
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS search_mode TEXT;
-- Señal de bloqueo detectada en la sesión (captcha / acceso denegado)
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS bloqueo_detectado BOOLEAN DEFAULT FALSE;
-- Reintentos totales de la sesión (usado por la vista v_bot_health)
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS reintentos INT DEFAULT 0;


-- ============================================================
-- 2. AMPLIAR bot_logs — métricas por CAUSA
-- ============================================================
-- (paso, screenshot_path y run_id ya vienen de schema-qa-trazabilidad.sql)
-- Cuánto tardó scrapear esta causa (ms). Detecta causas "pesadas".
ALTER TABLE bot_logs ADD COLUMN IF NOT EXISTS duracion_ms BIGINT;
-- Tipo de error categorizado (no texto libre): permite agrupar y aprender
ALTER TABLE bot_logs ADD COLUMN IF NOT EXISTS tipo_error TEXT;
--   Valores esperados de tipo_error:
--   'timeout' | 'no_encontrada' | 'navegacion' | 'parseo' | 'captcha' | 'sesion' | 'desconocido'


-- ============================================================
-- 3. NUEVA TABLA bot_step_metrics — tiempo por ETAPA
-- ============================================================
-- Registra cuánto tarda cada etapa (login, navegar, buscar, detalle, scrape)
-- y si tuvo éxito. Es lo que permite ver DÓNDE se va el tiempo y DÓNDE falla más.
CREATE TABLE IF NOT EXISTS bot_step_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id TEXT,
    rit TEXT,                       -- causa asociada (null para pasos globales como login)
    paso TEXT NOT NULL,             -- 'login' | 'navegacion' | 'busqueda' | 'detalle' | 'scrape' | 'logout'
    duracion_ms BIGINT,
    exito BOOLEAN DEFAULT TRUE,
    tipo_error TEXT,                -- mismo enum que bot_logs.tipo_error
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_step_metrics_run  ON bot_step_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_step_metrics_paso ON bot_step_metrics(paso);
CREATE INDEX IF NOT EXISTS idx_step_metrics_fecha ON bot_step_metrics(created_at DESC);

ALTER TABLE bot_step_metrics DISABLE ROW LEVEL SECURITY;


-- ============================================================
-- 4. VISTA v_bot_health — "¿cómo le está yendo al bot?"
-- ============================================================
-- Resumen de las últimas 30 corridas. Un vistazo y sabes si el bot está sano.
CREATE OR REPLACE VIEW v_bot_health AS
SELECT
    run_id,
    started_at,
    detenido_por,
    search_mode,
    total_causas,
    procesadas,
    exitosas,
    fallidas,
    tasa_exito,
    ROUND(duracion_ms / 60000.0, 1)  AS duracion_min,
    causas_por_min,
    reintentos,
    bloqueo_detectado
FROM bot_runs
ORDER BY started_at DESC
LIMIT 30;


-- ============================================================
-- 5. VISTA v_bot_fallos_por_paso — DÓNDE falla más el bot
-- ============================================================
-- Agrupa los fallos por etapa y tipo de error en los últimos 14 días.
-- Esta es la base de las RECOMENDACIONES: si "busqueda" falla mucho por
-- 'timeout', el motor sugiere subir el timeout; si aparece 'captcha', sugiere
-- bajar el ritmo. (El bot NO lo aplica solo: solo lo recomienda.)
CREATE OR REPLACE VIEW v_bot_fallos_por_paso AS
SELECT
    paso,
    COALESCE(tipo_error, 'desconocido') AS tipo_error,
    COUNT(*)                            AS ocurrencias,
    ROUND(AVG(duracion_ms))             AS duracion_ms_promedio,
    MAX(created_at)                     AS ultimo_visto
FROM bot_step_metrics
WHERE exito = FALSE
  AND created_at >= NOW() - INTERVAL '14 days'
GROUP BY paso, COALESCE(tipo_error, 'desconocido')
ORDER BY ocurrencias DESC;


-- ============================================================
-- 6. VISTA v_bot_causas_problematicas — causas que fallan seguido
-- ============================================================
-- Causas (RIT) que el bot no logra scrapear bien de forma recurrente.
-- Útil para revisarlas a mano o priorizar su reintento.
-- Ventana de 30 días (coherente con v_bot_health) para que una causa que falló
-- hace meses pero hoy anda bien no siga apareciendo como "problemática".
CREATE OR REPLACE VIEW v_bot_causas_problematicas AS
SELECT
    rit,
    COUNT(*) FILTER (WHERE error IS NOT NULL) AS veces_fallida,
    COUNT(*)                                  AS veces_intentada,
    MAX(fecha_scraping)                       AS ultimo_intento,
    (array_agg(tipo_error ORDER BY fecha_scraping DESC)
        FILTER (WHERE tipo_error IS NOT NULL))[1] AS ultimo_tipo_error
FROM bot_logs
WHERE rit IS NOT NULL
  AND fecha_scraping >= NOW() - INTERVAL '30 days'
GROUP BY rit
HAVING COUNT(*) FILTER (WHERE error IS NOT NULL) > 0
ORDER BY veces_fallida DESC, ultimo_intento DESC;


-- ✅ LISTO — Sistema de auto-aprendizaje (modo conservador) instalado.
--    El bot ahora registra métricas ricas y las resume en 3 vistas:
--      • v_bot_health              → salud general de las últimas corridas
--      • v_bot_fallos_por_paso     → dónde y por qué falla (base de recomendaciones)
--      • v_bot_causas_problematicas→ qué causas dan problemas recurrentes
