-- ============================================================
-- CAUSASPRO - Bitácora de cargas de asignaciones (tabla email_logs)
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ------------------------------------------------------------
-- El nombre es histórico: la escribió por primera vez el interceptor de correo, que ya
-- está dado de baja. Hoy la usa el flujo de pegado (/asignaciones) para registrar cada
-- carga: cuántas causas eran nuevas, cuántas ya existían, RITs involucrados y errores.
-- NO borrar esta tabla ni sus columnas: /api/asignaciones deja de funcionar sin ella.
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
