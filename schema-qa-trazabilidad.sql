-- ============================================================
-- CAUSASPRO QA - Trazabilidad de errores del bot
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================
--
-- Agrega a bot_logs el PASO donde ocurrió el fallo y la RUTA de la screenshot,
-- para tener trazabilidad completa: qué falló, en qué paso, con qué captura.
-- Requiere que schema-bot.sql (tabla bot_logs) ya se haya ejecutado.
-- ============================================================

ALTER TABLE bot_logs ADD COLUMN IF NOT EXISTS paso TEXT;             -- ej: 'login', 'search', 'detalle', 'scrape'
ALTER TABLE bot_logs ADD COLUMN IF NOT EXISTS screenshot_path TEXT;  -- ruta de la captura del fallo
ALTER TABLE bot_logs ADD COLUMN IF NOT EXISTS run_id TEXT;           -- para agrupar logs por sesión

CREATE INDEX IF NOT EXISTS idx_bot_logs_paso ON bot_logs(paso);
CREATE INDEX IF NOT EXISTS idx_bot_logs_run ON bot_logs(run_id);

-- Vista rápida de errores recientes (para revisar la trazabilidad de un vistazo)
CREATE OR REPLACE VIEW v_bot_errores AS
SELECT
    bl.fecha_scraping,
    bl.run_id,
    bl.rit,
    bl.paso,
    bl.error,
    bl.screenshot_path
FROM bot_logs bl
WHERE bl.error IS NOT NULL
ORDER BY bl.fecha_scraping DESC;
