-- ============================================================
-- CAUSASPRO - Multi-abogado (estudios, abogados, cartera, reparto)
-- Fase 4 - Paso 1: modelo de datos. SIN auth todavia (eso es el Paso 2).
-- Idempotente: se puede correr varias veces. No rompe datos existentes:
-- las columnas de ownership son NULL hasta que se asignen.
-- Ejecutar en el SQL editor de Supabase DESPUES de schema-negocio.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ESTUDIOS
-- Un estudio agrupa a varios abogados. Un abogado independiente
-- tambien es un "estudio" de una sola persona.
-- ============================================================
CREATE TABLE IF NOT EXISTS estudios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    rut TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ABOGADOS
-- Miembro de un estudio. rol: 'socio' | 'abogado'.
-- Un abogado pertenece a UN estudio (decision de negocio).
-- ============================================================
CREATE TABLE IF NOT EXISTS abogados (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    estudio_id UUID REFERENCES estudios(id) ON DELETE SET NULL,
    nombre TEXT NOT NULL,
    rut TEXT,
    email TEXT,
    rol TEXT NOT NULL DEFAULT 'abogado' CHECK (rol IN ('socio','abogado')),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    -- Reservado para el Paso 2 (auth): se linkeara con auth.users.id
    auth_user_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abogados_estudio ON abogados(estudio_id);
CREATE INDEX IF NOT EXISTS idx_abogados_auth ON abogados(auth_user_id);

-- ============================================================
-- OWNERSHIP: quien es el abogado responsable y a que estudio pertenece
-- cada causa / cliente / honorario. Nullable para no romper lo existente.
-- ============================================================
ALTER TABLE causas     ADD COLUMN IF NOT EXISTS abogado_id UUID REFERENCES abogados(id) ON DELETE SET NULL;
ALTER TABLE causas     ADD COLUMN IF NOT EXISTS estudio_id UUID REFERENCES estudios(id) ON DELETE SET NULL;
ALTER TABLE clientes   ADD COLUMN IF NOT EXISTS abogado_id UUID REFERENCES abogados(id) ON DELETE SET NULL;
ALTER TABLE clientes   ADD COLUMN IF NOT EXISTS estudio_id UUID REFERENCES estudios(id) ON DELETE SET NULL;
ALTER TABLE honorarios ADD COLUMN IF NOT EXISTS abogado_id UUID REFERENCES abogados(id) ON DELETE SET NULL;
ALTER TABLE honorarios ADD COLUMN IF NOT EXISTS estudio_id UUID REFERENCES estudios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_causas_abogado ON causas(abogado_id);
CREATE INDEX IF NOT EXISTS idx_causas_estudio ON causas(estudio_id);
CREATE INDEX IF NOT EXISTS idx_clientes_abogado ON clientes(abogado_id);
CREATE INDEX IF NOT EXISTS idx_honorarios_abogado ON honorarios(abogado_id);

-- ============================================================
-- REPARTO DE HONORARIOS ENTRE SOCIOS
-- Por cada honorario, define que % le toca a cada abogado.
-- La suma de porcentajes de un honorario deberia dar 100 (se valida en la app).
-- ============================================================
CREATE TABLE IF NOT EXISTS reparto_honorarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    honorario_id UUID NOT NULL REFERENCES honorarios(id) ON DELETE CASCADE,
    abogado_id UUID NOT NULL REFERENCES abogados(id) ON DELETE CASCADE,
    porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (porcentaje >= 0 AND porcentaje <= 100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (honorario_id, abogado_id)
);

CREATE INDEX IF NOT EXISTS idx_reparto_honorario ON reparto_honorarios(honorario_id);
CREATE INDEX IF NOT EXISTS idx_reparto_abogado ON reparto_honorarios(abogado_id);

-- ============================================================
-- TRIGGERS updated_at (reutiliza set_updated_at de schema-negocio)
-- ============================================================
DROP TRIGGER IF EXISTS estudios_updated ON estudios;
CREATE TRIGGER estudios_updated BEFORE UPDATE ON estudios
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS abogados_updated ON abogados;
CREATE TRIGGER abogados_updated BEFORE UPDATE ON abogados
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- VISTA: v_cartera_abogado
-- Resumen de la cartera de CADA abogado: cuantas causas, cuanto por cobrar,
-- cuanto vencido, considerando el reparto de honorarios cuando existe.
--
-- El "por cobrar atribuible" a un abogado = suma, por cada honorario donde
-- participa, de (pendiente del honorario * su porcentaje de reparto).
-- Si un honorario no tiene reparto, se atribuye 100% a su abogado_id.
-- ============================================================
-- Estrategia de atribucion (robusta ante repartos que NO suman 100%):
--   1. Cada fila de reparto atribuye pendiente*porcentaje a su abogado.
--   2. El REMANENTE (100 - suma de porcentajes del honorario, minimo 0) se
--      atribuye SIEMPRE al abogado dueno de la causa (honorarios.abogado_id).
-- Asi nunca se "pierde" plata: si un honorario no tiene reparto, la suma de
-- reparto es 0 y el 100% cae al dueno; si el reparto es parcial, el resto cae
-- al dueno; si suma 100%, el dueno recibe 0 por remanente. Sin doble conteo.
CREATE OR REPLACE VIEW v_cartera_abogado AS
WITH honorario_pendiente AS (
    SELECT
        hr.id AS honorario_id,
        h.abogado_id AS honorario_abogado_id,
        GREATEST(hr.monto_pactado - hr.total_pagado, 0) AS pendiente,
        hr.monto_vencido AS vencido,
        hr.estado
    FROM v_honorarios_resumen hr
    JOIN honorarios h ON h.id = hr.id
    WHERE hr.estado = 'activo'
),
-- Suma de porcentajes repartidos por honorario (0 si no tiene reparto)
reparto_suma AS (
    SELECT honorario_id, SUM(porcentaje) AS pct_repartido
    FROM reparto_honorarios
    GROUP BY honorario_id
),
-- 1) Atribucion por reparto explicito
atribucion_reparto AS (
    SELECT
        r.abogado_id,
        SUM(hp.pendiente * r.porcentaje / 100.0) AS pendiente_attr,
        SUM(hp.vencido  * r.porcentaje / 100.0) AS vencido_attr
    FROM reparto_honorarios r
    JOIN honorario_pendiente hp ON hp.honorario_id = r.honorario_id
    GROUP BY r.abogado_id
),
-- 2) Remanente (lo no repartido) atribuido al dueno de la causa
atribucion_remanente AS (
    SELECT
        hp.honorario_abogado_id AS abogado_id,
        SUM(hp.pendiente * (100 - LEAST(COALESCE(rs.pct_repartido, 0), 100)) / 100.0) AS pendiente_attr,
        SUM(hp.vencido  * (100 - LEAST(COALESCE(rs.pct_repartido, 0), 100)) / 100.0) AS vencido_attr
    FROM honorario_pendiente hp
    LEFT JOIN reparto_suma rs ON rs.honorario_id = hp.honorario_id
    WHERE hp.honorario_abogado_id IS NOT NULL
    GROUP BY hp.honorario_abogado_id
)
SELECT
    a.id AS abogado_id,
    a.nombre,
    a.rol,
    a.estudio_id,
    (SELECT COUNT(*) FROM causas c WHERE c.abogado_id = a.id) AS total_causas,
    COALESCE((SELECT COUNT(*) FROM clientes cl WHERE cl.abogado_id = a.id), 0) AS total_clientes,
    COALESCE(ar.pendiente_attr, 0) + COALESCE(arem.pendiente_attr, 0) AS por_cobrar,
    COALESCE(ar.vencido_attr, 0)   + COALESCE(arem.vencido_attr, 0)   AS vencido
FROM abogados a
LEFT JOIN atribucion_reparto ar ON ar.abogado_id = a.id
LEFT JOIN atribucion_remanente arem ON arem.abogado_id = a.id
WHERE a.activo = TRUE;

-- ============================================================
-- VISTA: v_cartera_estudio
-- Consolidado por estudio: suma los honorarios cuyo honorarios.estudio_id
-- coincide con el estudio. NOTA: esta metrica usa un criterio DISTINTO al de
-- v_cartera_abogado (que atribuye por ownership de causa + reparto). Por eso
-- "suma de carteras de abogados" puede NO cuadrar con el total del estudio si
-- las columnas estudio_id/abogado_id no estan alineadas. Son dos vistas de la
-- misma realidad con criterios distintos; el Paso 2 (auth) unificara ownership.
-- ============================================================
CREATE OR REPLACE VIEW v_cartera_estudio AS
SELECT
    e.id AS estudio_id,
    e.nombre,
    (SELECT COUNT(*) FROM abogados a WHERE a.estudio_id = e.id AND a.activo = TRUE) AS total_abogados,
    (SELECT COUNT(*) FROM causas c WHERE c.estudio_id = e.id) AS total_causas,
    (SELECT COUNT(*) FROM clientes cl WHERE cl.estudio_id = e.id) AS total_clientes,
    COALESCE((
        SELECT SUM(GREATEST(hr.monto_pactado - hr.total_pagado, 0))
        FROM v_honorarios_resumen hr
        JOIN honorarios h ON h.id = hr.id
        WHERE h.estudio_id = e.id AND hr.estado = 'activo'
    ), 0) AS por_cobrar,
    COALESCE((
        SELECT SUM(hr.monto_vencido)
        FROM v_honorarios_resumen hr
        JOIN honorarios h ON h.id = hr.id
        WHERE h.estudio_id = e.id AND hr.estado = 'activo'
    ), 0) AS vencido
FROM estudios e;

-- ============================================================
-- RLS deshabilitado (consistente con el resto; el Paso 2 activara RLS real)
-- ============================================================
ALTER TABLE estudios DISABLE ROW LEVEL SECURITY;
ALTER TABLE abogados DISABLE ROW LEVEL SECURITY;
ALTER TABLE reparto_honorarios DISABLE ROW LEVEL SECURITY;

-- LISTO - Modelo multi-abogado creado
