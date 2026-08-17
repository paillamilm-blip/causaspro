-- ============================================================
-- CAUSASPRO - Tabla de configuración (credenciales PJUD + IMAP)
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================

-- Habilitar extensión para encriptar
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS configuracion (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clave TEXT UNIQUE NOT NULL,        -- Nombre de la configuración
    valor TEXT,                         -- Valor (puede ser encriptado)
    encriptado BOOLEAN DEFAULT FALSE,   -- Si el valor está encriptado
    descripcion TEXT,                   -- Descripción para la UI
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar configuraciones por defecto
INSERT INTO configuracion (clave, valor, encriptado, descripcion) VALUES
    ('pjud_rut', NULL, FALSE, 'RUT para login en Oficina Judicial Virtual (formato: 12345678-9)'),
    ('pjud_password', NULL, TRUE, 'Contraseña del portal PJUD'),
    ('imap_host', NULL, FALSE, 'Servidor IMAP del correo (ej: mail.cajmetro.cl)'),
    ('imap_user', NULL, FALSE, 'Email completo (ej: usuario@cajmetro.cl)'),
    ('imap_password', NULL, TRUE, 'Contraseña del correo'),
    ('imap_port', '993', FALSE, 'Puerto IMAP (993 para SSL)'),
    ('bot_max_causas', '25', FALSE, 'Máximo de causas por sesión del bot'),
    ('bot_horario_1', '13:30', FALSE, 'Primera ejecución del bot (hora Chile)'),
    ('bot_horario_2', '02:00', FALSE, 'Segunda ejecución del bot (hora Chile)'),
    ('nombre_curador', NULL, FALSE, 'Tu nombre completo (para filtrar asignaciones)')
ON CONFLICT (clave) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_config_clave ON configuracion(clave);

ALTER TABLE configuracion DISABLE ROW LEVEL SECURITY;

-- Función para encriptar valores sensibles
CREATE OR REPLACE FUNCTION encrypt_config_value(plain_text TEXT, secret_key TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN encode(pgp_sym_encrypt(plain_text, secret_key), 'base64');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para desencriptar valores sensibles
CREATE OR REPLACE FUNCTION decrypt_config_value(encrypted_text TEXT, secret_key TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN pgp_sym_decrypt(decode(encrypted_text, 'base64'), secret_key);
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ✅ LISTO
