-- ============================================================
-- CAUSASPRO - Capa de Negocio (Clientes + Honorarios + Cuotas)
-- El diferenciador unico: conectar CAUSA -> CLIENTE -> COBRO
-- Ejecutar en el SQL editor de Supabase DESPUES de schema.sql y schema-bot.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- CLIENTES
-- El cliente puede tener varias causas asociadas.
-- ============================================================
CREATE TABLE IF NOT EXISTS clientes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    rut TEXT,
    email TEXT,
    telefono TEXT,
    direccion TEXT,
    notas TEXT,
    -- Token opaco para el portal del cliente (Fase 4). Sin login: acceso por link.
    portal_token UUID DEFAULT uuid_generate_v4(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clientes_rut ON clientes(rut);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_portal_token ON clientes(portal_token);

-- ============================================================
-- Vincular CAUSA -> CLIENTE
-- Una causa pertenece (opcionalmente) a un cliente.
-- Se agrega la columna sin romper el schema existente.
-- ============================================================
ALTER TABLE causas ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_causas_cliente ON causas(cliente_id);

-- ============================================================
-- HONORARIOS
-- Lo pactado con el cliente por una causa.
-- modalidad:
--   'fijo'  -> monto_total fijo
--   'exito' -> porcentaje sobre lo ganado (monto_total se calcula al cerrar)
--   'mixto' -> una parte fija + un porcentaje de exito
-- ============================================================
CREATE TABLE IF NOT EXISTS honorarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    causa_id UUID NOT NULL REFERENCES causas(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    modalidad TEXT NOT NULL DEFAULT 'fijo' CHECK (modalidad IN ('fijo','exito','mixto')),
    -- Montos en pesos chilenos (CLP). NUMERIC(14,0) = hasta 99 mil millones, sin decimales.
    monto_total NUMERIC(14,0) DEFAULT 0,          -- parte fija (fijo/mixto)
    porcentaje_exito NUMERIC(5,2) DEFAULT 0,      -- % sobre lo ganado (exito/mixto)
    monto_ganado NUMERIC(14,0) DEFAULT 0,         -- lo que se gano en juicio (para calcular exito)
    moneda TEXT NOT NULL DEFAULT 'CLP',
    descripcion TEXT,
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','cerrado','anulado')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_honorarios_causa ON honorarios(causa_id);
CREATE INDEX IF NOT EXISTS idx_honorarios_cliente ON honorarios(cliente_id);

-- ============================================================
-- CUOTAS
-- Cada cuota se rastrea por SEPARADO (inspirado en JuristPay).
-- estado: 'pendiente' | 'pagada' | 'vencida' (vencida se deriva por fecha, ver vista)
-- ============================================================
CREATE TABLE IF NOT EXISTS cuotas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    honorario_id UUID NOT NULL REFERENCES honorarios(id) ON DELETE CASCADE,
    numero INT NOT NULL,                     -- 1, 2, 3...
    monto NUMERIC(14,0) NOT NULL DEFAULT 0,  -- CLP
    fecha_vencimiento DATE,
    pagada BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_pago DATE,
    monto_pagado NUMERIC(14,0) DEFAULT 0,    -- soporta pagos parciales
    metodo_pago TEXT,                        -- 'transferencia', 'efectivo', 'tarjeta', etc.
    notas TEXT,
    -- Recordatorio de cobro (Fase 3): cuando se envio el ultimo aviso al cliente
    ultimo_recordatorio TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cuotas_honorario ON cuotas(honorario_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_vencimiento ON cuotas(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_cuotas_pendientes ON cuotas(pagada) WHERE pagada = FALSE;

-- ============================================================
-- TRIGGERS updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clientes_updated ON clientes;
CREATE TRIGGER clientes_updated BEFORE UPDATE ON clientes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS honorarios_updated ON honorarios;
CREATE TRIGGER honorarios_updated BEFORE UPDATE ON honorarios
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS cuotas_updated ON cuotas;
CREATE TRIGGER cuotas_updated BEFORE UPDATE ON cuotas
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- VISTA: v_honorarios_resumen
-- Por cada honorario: cuanto se pacto, cuanto se pago, cuanto se debe.
-- monto_pactado considera la modalidad (fijo/exito/mixto).
-- ============================================================
CREATE OR REPLACE VIEW v_honorarios_resumen AS
SELECT
    h.id,
    h.causa_id,
    h.cliente_id,
    h.modalidad,
    h.estado,
    h.moneda,
    -- Monto pactado segun modalidad
    CASE h.modalidad
        WHEN 'fijo'  THEN h.monto_total
        WHEN 'exito' THEN ROUND(h.monto_ganado * h.porcentaje_exito / 100.0)
        WHEN 'mixto' THEN h.monto_total + ROUND(h.monto_ganado * h.porcentaje_exito / 100.0)
        ELSE h.monto_total
    END AS monto_pactado,
    -- Total efectivamente pagado (suma de cuotas)
    COALESCE((SELECT SUM(cu.monto_pagado) FROM cuotas cu WHERE cu.honorario_id = h.id), 0) AS total_pagado,
    -- Total en cuotas generadas
    COALESCE((SELECT SUM(cu.monto) FROM cuotas cu WHERE cu.honorario_id = h.id), 0) AS total_en_cuotas,
    -- Numero de cuotas
    (SELECT COUNT(*) FROM cuotas cu WHERE cu.honorario_id = h.id) AS num_cuotas,
    (SELECT COUNT(*) FROM cuotas cu WHERE cu.honorario_id = h.id AND cu.pagada = TRUE) AS cuotas_pagadas,
    -- Cuotas vencidas (no pagadas y con fecha de vencimiento pasada)
    (SELECT COUNT(*) FROM cuotas cu
        WHERE cu.honorario_id = h.id AND cu.pagada = FALSE
          AND cu.fecha_vencimiento IS NOT NULL AND cu.fecha_vencimiento < CURRENT_DATE) AS cuotas_vencidas,
    (SELECT COALESCE(SUM(cu.monto - cu.monto_pagado), 0) FROM cuotas cu
        WHERE cu.honorario_id = h.id AND cu.pagada = FALSE
          AND cu.fecha_vencimiento IS NOT NULL AND cu.fecha_vencimiento < CURRENT_DATE) AS monto_vencido
FROM honorarios h;

-- ============================================================
-- VISTA: v_salud_financiera
-- Una sola fila con el pulso financiero del estudio (para el dashboard).
-- ============================================================
CREATE OR REPLACE VIEW v_salud_financiera AS
SELECT
    -- Por cobrar total (pactado - pagado, solo honorarios activos)
    COALESCE(SUM(hr.monto_pactado - hr.total_pagado) FILTER (WHERE hr.estado = 'activo'), 0) AS por_cobrar_total,
    -- Monto en cuotas vencidas (solo honorarios activos)
    COALESCE(SUM(hr.monto_vencido) FILTER (WHERE hr.estado = 'activo'), 0) AS monto_vencido_total,
    -- Numero de honorarios activos con al menos una cuota vencida
    COUNT(*) FILTER (WHERE hr.estado = 'activo' AND hr.cuotas_vencidas > 0) AS honorarios_con_mora,
    -- Ingresos del mes en curso (cuotas pagadas este mes)
    COALESCE((
        SELECT SUM(cu.monto_pagado) FROM cuotas cu
        WHERE cu.pagada = TRUE
          AND cu.fecha_pago >= date_trunc('month', CURRENT_DATE)
          AND cu.fecha_pago < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
    ), 0) AS ingresos_mes,
    -- Ingresos del mes anterior (para comparar tendencia)
    COALESCE((
        SELECT SUM(cu.monto_pagado) FROM cuotas cu
        WHERE cu.pagada = TRUE
          AND cu.fecha_pago >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
          AND cu.fecha_pago < date_trunc('month', CURRENT_DATE)
    ), 0) AS ingresos_mes_anterior,
    -- Totales de contexto
    (SELECT COUNT(*) FROM clientes) AS total_clientes,
    (SELECT COUNT(*) FROM honorarios WHERE estado = 'activo') AS honorarios_activos
FROM v_honorarios_resumen hr;

-- ============================================================
-- VISTA: v_cuotas_por_cobrar
-- Lista de cuotas pendientes/vencidas con datos de cliente y causa,
-- para la seccion de cobranza del dashboard.
-- ============================================================
CREATE OR REPLACE VIEW v_cuotas_por_cobrar AS
SELECT
    cu.id,
    cu.honorario_id,
    cu.numero,
    cu.monto,
    cu.monto_pagado,
    (cu.monto - cu.monto_pagado) AS saldo,
    cu.fecha_vencimiento,
    cu.pagada,
    CASE
        WHEN cu.pagada THEN 'pagada'
        WHEN cu.fecha_vencimiento IS NOT NULL AND cu.fecha_vencimiento < CURRENT_DATE THEN 'vencida'
        ELSE 'pendiente'
    END AS estado_cuota,
    CASE
        WHEN cu.pagada = FALSE AND cu.fecha_vencimiento IS NOT NULL AND cu.fecha_vencimiento < CURRENT_DATE
        THEN (CURRENT_DATE - cu.fecha_vencimiento)
        ELSE NULL
    END AS dias_vencida,
    h.causa_id,
    c.rit,
    c.caratulado,
    cl.id AS cliente_id,
    cl.nombre AS cliente_nombre,
    cl.telefono AS cliente_telefono,
    cl.email AS cliente_email
FROM cuotas cu
JOIN honorarios h ON h.id = cu.honorario_id
LEFT JOIN causas c ON c.id = h.causa_id
LEFT JOIN clientes cl ON cl.id = COALESCE(h.cliente_id, c.cliente_id)
WHERE cu.pagada = FALSE
  AND h.estado = 'activo'  -- no mostrar cuotas de honorarios anulados/cerrados
ORDER BY cu.fecha_vencimiento ASC NULLS LAST;

-- ============================================================
-- RLS deshabilitado (consistente con el resto del proyecto)
-- ============================================================
ALTER TABLE clientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE honorarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE cuotas DISABLE ROW LEVEL SECURITY;

-- LISTO - Capa de negocio creada
