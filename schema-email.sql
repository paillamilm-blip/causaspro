-- ============================================================
-- CAUSASPRO EMAIL INTERCEPTOR - Tabla de logs
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================

CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_id TEXT,
    fecha_email TEXT,
    remitente TEXT,
    asignaciones_total INT DEFAULT 0,
    causas_nuevas INT DEFAULT 0,
    causas_existentes INT DEFAULT 0,
    audiencias_creadas INT DEFAULT 0,
    errores TEXT[],
    rits TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_fecha ON email_logs(created_at DESC);

ALTER TABLE email_logs DISABLE ROW LEVEL SECURITY;

-- ✅ LISTO
