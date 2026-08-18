-- ============================================================
-- CAUSASPRO - Agregar campo flexible para columnas extras
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================

-- Agregar columna JSONB para almacenar TODAS las columnas del Excel
ALTER TABLE causas ADD COLUMN IF NOT EXISTS datos_extra JSONB DEFAULT '{}';

-- Agregar columna para guardar los nombres de columnas del archivo original
ALTER TABLE causas ADD COLUMN IF NOT EXISTS columnas_origen TEXT[];

-- Índice para búsqueda en datos_extra
CREATE INDEX IF NOT EXISTS idx_causas_datos_extra ON causas USING GIN (datos_extra);

-- ✅ LISTO - Ahora todas las columnas del Excel se guardan
