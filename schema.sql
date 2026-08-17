-- ============================================================
-- CAUSASPRO - Schema de Base de Datos
-- Pegar en: https://supabase.com/dashboard/project/cuwuyqpxaibbqjrvamjb/sql/new
-- Click RUN
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Limpiar si ya existían
DROP VIEW IF EXISTS v_causas_ranking CASCADE;
DROP TABLE IF EXISTS medidas_cautelares CASCADE;
DROP TABLE IF EXISTS programas CASCADE;
DROP TABLE IF EXISTS gestiones CASCADE;
DROP TABLE IF EXISTS audiencias CASCADE;
DROP TABLE IF EXISTS adultos CASCADE;
DROP TABLE IF EXISTS nna CASCADE;
DROP TABLE IF EXISTS causas CASCADE;

-- ============================================================
-- CAUSAS
-- ============================================================
CREATE TABLE causas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rit TEXT NOT NULL,
    rit_acumulados TEXT,
    caratulado TEXT,
    tipo TEXT CHECK (tipo IN ('P','X')),
    fecha_apertura DATE,
    fecha_notificacion DATE,
    sintesis TEXT,
    estado TEXT,
    programa_vigente TEXT,
    saj TEXT,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_causas_rit ON causas(rit);

-- ============================================================
-- NNA
-- ============================================================
CREATE TABLE nna (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    causa_id UUID NOT NULL REFERENCES causas(id) ON DELETE CASCADE,
    nombre TEXT,
    apellido TEXT,
    rut TEXT,
    fecha_nacimiento DATE,
    edad NUMERIC(5,1),
    nacionalidad TEXT,
    direccion TEXT,
    colegio TEXT,
    curso TEXT,
    cesfam TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_nna_causa ON nna(causa_id);

-- ============================================================
-- ADULTOS RESPONSABLES
-- ============================================================
CREATE TABLE adultos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    causa_id UUID NOT NULL REFERENCES causas(id) ON DELETE CASCADE,
    nombre TEXT,
    relacion TEXT,
    telefono TEXT,
    direccion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_adultos_causa ON adultos(causa_id);

-- ============================================================
-- AUDIENCIAS
-- ============================================================
CREATE TABLE audiencias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    causa_id UUID NOT NULL REFERENCES causas(id) ON DELETE CASCADE,
    fecha TIMESTAMPTZ,
    tipo TEXT,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audiencias_causa ON audiencias(causa_id);
CREATE INDEX idx_audiencias_fecha ON audiencias(fecha);

-- ============================================================
-- GESTIONES (extras del abogado - futuro)
-- ============================================================
CREATE TABLE gestiones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    causa_id UUID NOT NULL REFERENCES causas(id) ON DELETE CASCADE,
    fecha DATE DEFAULT CURRENT_DATE,
    tipo TEXT,
    contenido TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROGRAMAS
-- ============================================================
CREATE TABLE programas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    causa_id UUID NOT NULL REFERENCES causas(id) ON DELETE CASCADE,
    tipo TEXT,
    nombre TEXT,
    estado TEXT,
    fecha_ingreso DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MEDIDAS CAUTELARES
-- ============================================================
CREATE TABLE medidas_cautelares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    causa_id UUID NOT NULL REFERENCES causas(id) ON DELETE CASCADE,
    tipo TEXT,
    persona_afectada TEXT,
    fecha_vencimiento DATE,
    vigente BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VISTA: Ranking de causas por urgencia
-- ============================================================
CREATE OR REPLACE VIEW v_causas_ranking AS
SELECT 
    c.id,
    c.rit,
    c.caratulado,
    c.tipo,
    c.estado,
    c.programa_vigente,
    c.sintesis,
    c.notas,
    c.updated_at,
    -- Contar NNA
    (SELECT COUNT(*) FROM nna n WHERE n.causa_id = c.id) AS total_nna,
    -- Nombres NNA
    (SELECT string_agg(COALESCE(n.nombre,'') || ' ' || COALESCE(n.apellido,''), ' | ') 
     FROM nna n WHERE n.causa_id = c.id) AS nombres_nna,
    -- Próxima audiencia
    (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) AS proxima_audiencia,
    -- Días para próxima audiencia
    (SELECT EXTRACT(DAY FROM MIN(a.fecha) - NOW()) 
     FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) AS dias_para_audiencia,
    -- Adulto responsable
    (SELECT ad.nombre FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_nombre,
    (SELECT ad.telefono FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_telefono
FROM causas c
ORDER BY 
    -- Prioridad: 1) con audiencia pronto, 2) resto por fecha update
    CASE 
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL 
        THEN 0 ELSE 1 
    END,
    (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) ASC NULLS LAST,
    c.updated_at DESC;

-- ============================================================
-- TRIGGER updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER causas_updated BEFORE UPDATE ON causas
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Deshabilitar RLS para carga
ALTER TABLE causas DISABLE ROW LEVEL SECURITY;
ALTER TABLE nna DISABLE ROW LEVEL SECURITY;
ALTER TABLE adultos DISABLE ROW LEVEL SECURITY;
ALTER TABLE audiencias DISABLE ROW LEVEL SECURITY;
ALTER TABLE gestiones DISABLE ROW LEVEL SECURITY;
ALTER TABLE programas DISABLE ROW LEVEL SECURITY;
ALTER TABLE medidas_cautelares DISABLE ROW LEVEL SECURITY;

-- ✅ LISTO - Ahora deploya la app
