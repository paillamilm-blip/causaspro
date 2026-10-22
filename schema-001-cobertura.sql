-- ============================================================
-- CAUSASPRO - schema-001-cobertura.sql
-- CONTROL DE COBERTURA: cola de escaneo + unicidad + trazabilidad
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================
--
-- QUÉ RESUELVE:
--   1. Saber SIEMPRE cuántas causas faltan por escanear (cola en la BD, no en tu cabeza).
--   2. Identidad: duplicados de `causas` detectables y fusionables; índice único cuando proceda.
--   3. Idempotencia: el bot puede re-escanear 50 veces la misma causa sin duplicar movimientos/audiencias.
--   4. Rastro por corrida: cada causa que un lote tocó (o intentó) queda en bot_run_items.
--   5. Baseline del Excel: cada carga deja constancia cuantitativa (carga_lotes).
--   6. Inventario del portal (base para la conciliación PJUD↔BD).
--
-- Es 100% ADITIVO e IDEMPOTENTE: no borra datos de causas; solo deduplica movimientos/
-- audiencias que ya estaban repetidos (conservando la fila más antigua, mismo criterio
-- que schema-dedup-hijos.sql). Se puede correr más de una vez sin romper nada.
--
-- ORDEN: (1) correr ESTE script en Supabase, (2) luego desplegar el código nuevo.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) COLUMNAS DE IDENTIDAD Y COBERTURA EN `causas`
-- ------------------------------------------------------------
ALTER TABLE causas ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'excel';
  -- valores: 'excel' (carga original) | 'asignada' (pegada en /asignaciones)
  --         | 'portal' (detectada por conciliación) | 'migracion'
ALTER TABLE causas ADD COLUMN IF NOT EXISTS carga_lote_id UUID;

-- Cola de escaneo (la métrica única del panel)
ALTER TABLE causas ADD COLUMN IF NOT EXISTS escaneo_estado TEXT NOT NULL DEFAULT 'pendiente'
  CHECK (escaneo_estado IN ('pendiente','en_progreso','ok','sin_datos','error','descatalogada'));
  -- 'ok'          → el bot la visitó y hay movimientos
  -- 'sin_datos'   → el bot la visitó y el portal NO muestra movimientos (NO es "falta escanear")
  -- 'error'       → último intento falló (login, timeout, 404 del RIT)
  -- 'descatalogada' → ya no aparece en el inventario del portal
ALTER TABLE causas ADD COLUMN IF NOT EXISTS ultima_escaneada TIMESTAMPTZ;
ALTER TABLE causas ADD COLUMN IF NOT EXISTS escaneos_totales INT NOT NULL DEFAULT 0;
ALTER TABLE causas ADD COLUMN IF NOT EXISTS ultima_run_id TEXT;
ALTER TABLE causas ADD COLUMN IF NOT EXISTS pendientes_desde TIMESTAMPTZ;
  -- la mantiene el trigger trg_causas_cola de la sección 1b, no el DEFAULT

-- Clave normalizada para unicidad: `rit` es texto de display (la letra puede faltar o
-- coexistir P↔X a propósito). rit_norm = recorte+mayúsculas del MISMO rit; P-… y X-…
-- legitiman dos filas distintas. Una fila con letra faltante ("4596-2024") vs su versión
-- completa ("P-4596-2024") NO la atrapa el índice: para eso está v_causas_duplicadas.
ALTER TABLE causas ADD COLUMN IF NOT EXISTS rit_norm TEXT
  GENERATED ALWAYS AS (upper(btrim(replace(rit, ' ', '')))) STORED;

CREATE INDEX IF NOT EXISTS idx_causas_escaneo_estado ON causas(escaneo_estado);
-- Cola priorizada: pendientes primero (NULLS FIRST por si alguna quedó sin fecha)
CREATE INDEX IF NOT EXISTS idx_causas_cola ON causas(ultima_escaneada NULLS FIRST, pendientes_desde)
  WHERE escaneo_estado IN ('pendiente','error');

-- 1b) Trigger de cola: pendientes_desde se mantiene SOLO mientras el estado es
--     pendiente/error; al pasar a ok/sin_datos se limpia. Así la cola siempre es honesta.
CREATE OR REPLACE FUNCTION trg_causas_cola_fn() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.escaneo_estado IN ('pendiente','error') THEN
    IF TG_OP = 'INSERT' OR OLD.escaneo_estado NOT IN ('pendiente','error') OR OLD.pendientes_desde IS NULL THEN
      NEW.pendientes_desde := COALESCE(NEW.pendientes_desde, now());
    END IF;
  ELSE
    NEW.pendientes_desde := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_causas_cola ON causas;
CREATE TRIGGER trg_causas_cola BEFORE INSERT OR UPDATE ON causas
FOR EACH ROW EXECUTE FUNCTION trg_causas_cola_fn();

-- ------------------------------------------------------------
-- 2) DEDUP DE MOVIMIENTOS Y AUDIENCIAS + IDENTITY PARA UPSERT
--    (necesario para que el bot use upsert onConflict y sea idempotente)
-- ------------------------------------------------------------
-- POR QUÉ TRIGGERS Y NO COLUMNAS GENERADAS
-- Postgres exige que la expresión de una GENERATED ALWAYS AS sea IMMUTABLE, y
-- to_char() es STABLE (depende de lc_time) igual que cualquier conversión de
-- TIMESTAMPTZ. Da lo mismo el tipo real de `fecha` en cada base: con una columna
-- generada esto revienta con 42P17. Un trigger no tiene esa restricción.
-- `SET timezone = 'UTC'` fija el día aunque la sesión que inserta esté en otra zona.

-- 2a. Movimientos: clave = día + trámite.
ALTER TABLE movimientos DROP COLUMN IF EXISTS uniq_clave;
ALTER TABLE movimientos ADD COLUMN uniq_clave TEXT;

CREATE OR REPLACE FUNCTION trg_movimientos_uniq_fn() RETURNS TRIGGER
LANGUAGE plpgsql SET timezone = 'UTC' AS $$
BEGIN
  NEW.uniq_clave := coalesce(to_char(NEW.fecha::date, 'YYYY-MM-DD'), '-')
                 || '|' || lower(btrim(coalesce(NEW.tramite, '')));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_movimientos_uniq ON movimientos;
CREATE TRIGGER trg_movimientos_uniq BEFORE INSERT OR UPDATE ON movimientos
FOR EACH ROW EXECUTE FUNCTION trg_movimientos_uniq_fn();

-- Rellena las filas existentes: el trigger BEFORE UPDATE recalcula la clave, así que
-- el valor del SET no importa y la expresión vive en un solo lugar.
UPDATE movimientos SET uniq_clave = NULL WHERE uniq_clave IS NULL;

-- Borrar duplicados exactos (misma causa + misma clave), la más antigua gana.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY causa_id, uniq_clave
    ORDER BY created_at ASC, id ASC) AS rn
  FROM movimientos
)
DELETE FROM movimientos WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_movimientos_causa_uniq
  ON movimientos(causa_id, uniq_clave);

-- 2b. Audiencias: mismo patrón (causa + día + tipo).
ALTER TABLE audiencias DROP COLUMN IF EXISTS uniq_clave;
ALTER TABLE audiencias ADD COLUMN uniq_clave TEXT;

CREATE OR REPLACE FUNCTION trg_audiencias_uniq_fn() RETURNS TRIGGER
LANGUAGE plpgsql SET timezone = 'UTC' AS $$
BEGIN
  NEW.uniq_clave := coalesce(to_char(NEW.fecha::date, 'YYYY-MM-DD'), '-')
                 || '|' || lower(btrim(coalesce(NEW.tipo, '')));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audiencias_uniq ON audiencias;
CREATE TRIGGER trg_audiencias_uniq BEFORE INSERT OR UPDATE ON audiencias
FOR EACH ROW EXECUTE FUNCTION trg_audiencias_uniq_fn();

UPDATE audiencias SET uniq_clave = NULL WHERE uniq_clave IS NULL;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY causa_id, uniq_clave
    ORDER BY created_at ASC, id ASC) AS rn
  FROM audiencias
)
DELETE FROM audiencias WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_audiencias_causa_uniq
  ON audiencias(causa_id, uniq_clave);

-- ------------------------------------------------------------
-- 3) DETECCIÓN Y FUSIÓN DE DUPLICADOS DE CAUSAS
-- ------------------------------------------------------------
-- Vista de diagnóstico: grupos con el mismo (rol, anio) — incluido el caso
-- letra-missing ("4596-2024" vs "P-4596-2024").
CREATE OR REPLACE VIEW v_causas_duplicadas AS
SELECT rol, anio, count(*) AS filas,
       array_agg(rit ORDER BY created_at)        AS rits,
       array_agg(id::text ORDER BY created_at)   AS ids,
       array_agg(escaneo_estado ORDER BY created_at) AS estados
FROM causas
WHERE rol IS NOT NULL AND anio IS NOT NULL
GROUP BY rol, anio
HAVING count(*) > 1
ORDER BY filas DESC, rol;

-- Fusión segura: repunta TODOS los hijos a la causa conservada y borra la fundida.
-- Uso: SELECT fusionar_causas(conservar_id, fundir_id);
CREATE OR REPLACE FUNCTION fusionar_causas(p_conservar UUID, p_fundir UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_conservar = p_fundir THEN RAISE EXCEPTION 'ids iguales'; END IF;
  IF NOT EXISTS (SELECT 1 FROM causas WHERE id = p_conservar) THEN RAISE EXCEPTION 'conservar inexistente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM causas WHERE id = p_fundir)     THEN RAISE EXCEPTION 'fundir inexistente';   END IF;

  UPDATE nna               SET causa_id = p_conservar WHERE causa_id = p_fundir;
  UPDATE adultos           SET causa_id = p_conservar WHERE causa_id = p_fundir;
  UPDATE audiencias        SET causa_id = p_conservar WHERE causa_id = p_fundir;
  UPDATE gestiones         SET causa_id = p_conservar WHERE causa_id = p_fundir;
  UPDATE programas         SET causa_id = p_conservar WHERE causa_id = p_fundir;
  UPDATE medidas_cautelares SET causa_id = p_conservar WHERE causa_id = p_fundir;
  UPDATE bot_logs          SET causa_id = p_conservar WHERE causa_id = p_fundir;
  -- movimientos: los duplicados exactos del lado fundido chocan con el índice único;
  -- se eliminan antes de repuntar.
  DELETE FROM movimientos m
   WHERE m.causa_id = p_fundir
     AND EXISTS (SELECT 1 FROM movimientos k
                 WHERE k.causa_id = p_conservar AND k.uniq_clave = m.uniq_clave);
  UPDATE movimientos SET causa_id = p_conservar WHERE causa_id = p_fundir;
  -- igual para audiencias
  DELETE FROM audiencias a
   WHERE a.causa_id = p_fundir
     AND EXISTS (SELECT 1 FROM audiencias k
                 WHERE k.causa_id = p_conservar AND k.uniq_clave = a.uniq_clave);

  DELETE FROM causas WHERE id = p_fundir;
END $$;

-- Índice único de display: SOLO cuando ya no quedan rit_norm duplicados.
-- Si hay duplicados, el script avisa con WARNING y NO crea el índice; tras fusionar
-- con v_causas_duplicadas + fusionar_causas(), volver a correr ESTE MISMO script.
DO $$
DECLARE n_dup INT;
BEGIN
  SELECT count(*) INTO n_dup FROM (
    SELECT rit_norm FROM causas GROUP BY rit_norm HAVING count(*) > 1
  ) d;
  IF n_dup = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_causas_rit_norm ON causas(rit_norm);
    RAISE NOTICE 'uq_causas_rit_norm creado: el upsert por rit es seguro.';
  ELSE
    RAISE WARNING 'Hay % rit_norm duplicados. Revisar v_causas_duplicadas y fusionar; luego re-correr este script.', n_dup;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4) TRAZABILIDAD DE CORRIDAS POR CAUSA
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bot_run_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id TEXT NOT NULL,
    causa_id UUID REFERENCES causas(id) ON DELETE SET NULL,
    rit TEXT NOT NULL,
    resultado TEXT NOT NULL DEFAULT 'ok'
      CHECK (resultado IN ('ok','sin_movimientos','no_encontrada','error','no_intentada')),
    movimientos_nuevos INT DEFAULT 0,
    error TEXT,
    creada_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_run_items_run ON bot_run_items(run_id, creada_at);
CREATE INDEX IF NOT EXISTS idx_run_items_causa ON bot_run_items(causa_id, creada_at DESC);

-- Baseline cuantitativo de cada carga de Excel (para la migración única)
CREATE TABLE IF NOT EXISTS carga_lotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    origen TEXT NOT NULL DEFAULT 'excel',       -- 'excel' | 'pegado'
    descripcion TEXT,                            -- nombre del archivo o texto del pegado
    filas_totales INT DEFAULT 0,
    nuevos INT DEFAULT 0,
    existentes INT DEFAULT 0,
    no_reconocidos TEXT[],                       -- líneas que el parser NO entendió (visibles, no silenciosas)
    creado_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inventario del portal (base de la conciliación PJUD↔BD; la llenará el bot en modo inventario)
CREATE TABLE IF NOT EXISTS inventario_portal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rit TEXT NOT NULL,
    rol INTEGER,
    anio INTEGER,
    caratulado TEXT,
    estado_portal TEXT,
    detectado_en TIMESTAMPTZ DEFAULT NOW(),       -- corrida de inventario
    desaparecida_desde TIMESTAMPTZ,               -- NULL = sigue visible en el portal
    UNIQUE (rit, detectado_en)
);
CREATE INDEX IF NOT EXISTS idx_inventario_rit ON inventario_portal(rit);

-- ------------------------------------------------------------
-- 5) VISTAS DE COBERTURA (la métrica única del panel)
-- ------------------------------------------------------------
-- Conteo global por estado
CREATE OR REPLACE VIEW v_cobertura AS
SELECT
  count(*)                                                    AS total_causas,
  count(*) FILTER (WHERE escaneo_estado = 'pendiente')        AS pendientes,
  -- Las NUNCA escaneadas son las que responden a "¿están todas cargadas?": si esto es 0,
  -- el bot pasó por todas. Un 'pendiente' con fecha vieja es re-escaneo, no causa olvidada.
  count(*) FILTER (WHERE ultima_escaneada IS NULL
                   AND escaneo_estado <> 'descatalogada')     AS nunca_escaneadas,
  count(*) FILTER (WHERE escaneo_estado = 'en_progreso')      AS en_progreso,
  count(*) FILTER (WHERE escaneo_estado = 'ok')               AS ok,
  count(*) FILTER (WHERE escaneo_estado = 'sin_datos')        AS sin_datos,
  count(*) FILTER (WHERE escaneo_estado = 'error')            AS con_error,
  count(*) FILTER (WHERE escaneo_estado = 'descatalogada')    AS descatalogadas,
  -- VENCIDAS = 'ok' escaneadas hace más de 7 días. Se cuentan aparte porque el bot solo
  -- re-encola al ARRANCAR: si el panel solo mirara escaneo_estado, después de una corrida
  -- diría "0 pendientes, no hace falta correr el bot" aunque al día siguiente ya hiciera
  -- falta. Este criterio se calcula contra NOW(), así que la métrica envejece sola.
  -- (Debe coincidir con BOT_DIAS_RENOVACION del bot, que re-encola con el mismo umbral.)
  count(*) FILTER (WHERE escaneo_estado IN ('ok','sin_datos')
                   AND ultima_escaneada < NOW() - INTERVAL '7 days') AS vencidas,
  min(ultima_escaneada) FILTER (WHERE escaneo_estado <> 'descatalogada') AS escaneo_mas_antiguo,
  now() - min(ultima_escaneada) FILTER (WHERE escaneo_estado <> 'descatalogada') AS brecha_maxima,
  -- Versión NUMÉRICA (días) para el panel: PostgREST devuelve el INTERVAL como texto
  -- ("27 days 03:12:45") y hay que parsearlo en el navegador. Esto no.
  ROUND(EXTRACT(EPOCH FROM (now() - min(ultima_escaneada)
    FILTER (WHERE escaneo_estado <> 'descatalogada'))) / 86400.0, 1) AS rezago_maximo_dias,
  now() AS medido_en,
  -- LAS DOS COLUMNAS DE ABAJO VAN AL FINAL A PROPÓSITO: CREATE OR REPLACE VIEW no permite
  -- reordenar ni sacar columnas, solo agregar al final. En una base que ya tiene la vista,
  -- ponerlas antes de medido_en haría fallar el reemplazo.

  -- FUERA DE COLA: causas que el bot NUNCA va a reintentar porque están marcadas en `notas`
  -- con alguna de las 4 marcas que también filtran getCausasToScrape() (esRuidoNotas) y
  -- noCargablePorBot() en el panel. Mantener los tres criterios iguales:
  --   [NO EN PORTAL]           → el portal confirmó que no está en Mis Causas
  --   [REVISAR: no scrapeada]  → cuarentena tras N fallos transitorios
  --   [REVISAR LETRA]          → el RIT de la base no coincide con el del portal
  --   [TERMINADA]              → la curadora la cerró a mano
  -- Solo cuentan las que ADEMÁS están en un estado de trabajo: una [TERMINADA] ya escaneada
  -- ('ok') no le roba nada a la métrica y sacarla del denominador rompería el porcentaje.
  count(*) FILTER (WHERE escaneo_estado IN ('pendiente','en_progreso','error')
                   AND (upper(coalesce(notas, '')) LIKE '%[NO EN PORTAL]%'
                     OR upper(coalesce(notas, '')) LIKE '%[REVISAR: NO SCRAPEADA]%'
                     OR upper(coalesce(notas, '')) LIKE '%[REVISAR LETRA]%'
                     OR upper(coalesce(notas, '')) LIKE '%[TERMINADA]%')) AS fuera_de_cola,
  -- POR ESCANEAR: el número grande del panel. Es la cola REAL del bot (mismo criterio que
  -- v_cola_escaneo) menos las que están fuera de cola. Sin esta columna el panel sumaba
  -- con_error al total y las causas trabadas por letra lo inflaban para siempre: el bot no
  -- las reintenta, así que ese número nunca podía llegar a 0 por más corridas que hiciera.
  count(*) FILTER (WHERE (escaneo_estado IN ('pendiente','en_progreso','error')
                          AND NOT (upper(coalesce(notas, '')) LIKE '%[NO EN PORTAL]%'
                                OR upper(coalesce(notas, '')) LIKE '%[REVISAR: NO SCRAPEADA]%'
                                OR upper(coalesce(notas, '')) LIKE '%[REVISAR LETRA]%'
                                OR upper(coalesce(notas, '')) LIKE '%[TERMINADA]%'))
                     OR (escaneo_estado IN ('ok','sin_datos')
                         AND ultima_escaneada < NOW() - INTERVAL '7 days')) AS por_escanear
FROM causas;

-- Cola de trabajo que consume el bot (nunca escaneadas primero)
CREATE OR REPLACE VIEW v_cola_escaneo AS
SELECT id, rit, rol, anio, caratulado, estado AS estado_causa,
       escaneo_estado, ultima_escaneada, pendientes_desde,
       NOW() - ultima_escaneada AS antiguedad_escaneo
FROM causas
WHERE escaneo_estado IN ('pendiente','error')
   OR (escaneo_estado IN ('ok','sin_datos') AND ultima_escaneada < NOW() - INTERVAL '7 days')
ORDER BY ultima_escaneada ASC NULLS FIRST, pendientes_desde ASC NULLS LAST;

-- Progreso en vivo de la corrida activa (polling del dashboard, barato: lee 1 fila)
CREATE OR REPLACE VIEW v_run_activo AS
SELECT r.run_id, r.started_at, r.finished_at, r.total_causas,
       r.procesadas, r.exitosas, r.fallidas, r.detenido_por,
       count(i.id) FILTER (WHERE i.resultado = 'ok')               AS items_ok,
       count(i.id) FILTER (WHERE i.resultado = 'sin_movimientos')  AS items_sin_mov,
       count(i.id) FILTER (WHERE i.resultado = 'no_encontrada')    AS items_no_encontrada,
       count(i.id) FILTER (WHERE i.resultado = 'error')            AS items_error,
       max(i.creada_at)                                            AS ultimo_item_en
FROM bot_runs r
LEFT JOIN bot_run_items i ON i.run_id = r.run_id
GROUP BY r.run_id, r.started_at, r.finished_at, r.total_causas,
         r.procesadas, r.exitosas, r.fallidas, r.detenido_por
ORDER BY r.started_at DESC NULLS LAST
LIMIT 20;

-- ------------------------------------------------------------
-- 5b) CONCILIACIÓN PORTAL ↔ BASE — la respuesta honesta a "¿están todas?"
--     v_cobertura solo puede contar causas que YA están en la base. Una causa que nunca
--     se pegó es invisible para ella, así que "0 pendientes" NO significa "están todas".
--     Este bloque compara contra el inventario que escribe el bot (BOT_INVENTARIO=1).
--     La comparación es por NÚMERO+AÑO, no por RIT completo: la letra es la parte menos
--     fiable del dato (P↔X vinculadas, causas que cambian de materia, y los RIT de la
--     curadora suelen anotarse sin letra). La letra distinta se reporta aparte, no mezclado.
-- ------------------------------------------------------------

-- Expresión MUST match src/bot/modules/supabaseSync.ts :: ritSinLetra()
ALTER TABLE causas ADD COLUMN IF NOT EXISTS rit_sin_letra TEXT
  GENERATED ALWAYS AS (
    btrim(regexp_replace(regexp_replace(upper(rit), '\s', '', 'g'), '[^0-9-]', '', 'g'), '-')
  ) STORED;

ALTER TABLE inventario_portal ADD COLUMN IF NOT EXISTS rit_sin_letra TEXT
  GENERATED ALWAYS AS (
    btrim(regexp_replace(regexp_replace(upper(rit), '\s', '', 'g'), '[^0-9-]', '', 'g'), '-')
  ) STORED;

ALTER TABLE inventario_portal ADD COLUMN IF NOT EXISTS rit_norm TEXT
  GENERATED ALWAYS AS (upper(btrim(replace(rit, ' ', '')))) STORED;

CREATE INDEX IF NOT EXISTS idx_causas_rit_sin_letra     ON causas(rit_sin_letra);
CREATE INDEX IF NOT EXISTS idx_inventario_rit_sin_letra ON inventario_portal(rit_sin_letra);

-- Una fila por causa visible en el ÚLTIMO inventario, con su situación contra la base.
CREATE OR REPLACE VIEW v_conciliacion_detalle AS
WITH ultimo AS (SELECT max(detectado_en) AS corrida_en FROM inventario_portal),
p AS (
  SELECT DISTINCT i.rit, i.caratulado, i.rit_sin_letra, i.rit_norm
  FROM inventario_portal i
  JOIN ultimo u ON u.corrida_en = i.detectado_en
)
SELECT
  u.corrida_en,
  p.rit,
  p.caratulado,
  p.rit_sin_letra,
  CASE
    WHEN EXISTS (SELECT 1 FROM causas c
                 WHERE c.rit_sin_letra = p.rit_sin_letra AND c.rit_norm = p.rit_norm) THEN 'coincide'
    WHEN EXISTS (SELECT 1 FROM causas c WHERE c.rit_sin_letra = p.rit_sin_letra)       THEN 'letra_distinta'
    ELSE 'falta_en_bd'
  END AS situacion
FROM ultimo u, p;

-- El resumen de una fila que lee el panel.
-- en_bd_no_vistas_en_portal: causas de TU base que el portal ya no muestra en Mis Causas.
-- Se descartan las ya marcadas [TERMINADA] / [NO EN PORTAL] (baja conocida) para que el
-- número no crezca con lo que ya sabés. Es un AVISO, no una baja: una causa archivada
-- desaparece del listado sin estar terminada.
CREATE OR REPLACE VIEW v_conciliacion AS
SELECT
  (SELECT max(detectado_en) FROM inventario_portal) AS corrida_en,
  count(*)                                        AS rits_portal,
  count(*) FILTER (WHERE situacion = 'coincide')      AS coinciden,
  count(*) FILTER (WHERE situacion = 'falta_en_bd')   AS faltan_en_bd,
  count(*) FILTER (WHERE situacion = 'letra_distinta') AS letra_distinta,
  CASE WHEN (SELECT max(detectado_en) FROM inventario_portal) IS NULL THEN NULL ELSE (
    SELECT count(*)
    FROM causas c
    WHERE c.escaneo_estado <> 'descatalogada'
      AND coalesce(c.notas, '') NOT LIKE '%[TERMINADA]%'
      AND coalesce(c.notas, '') NOT LIKE '%[NO EN PORTAL]%'
      AND NOT EXISTS (
        SELECT 1 FROM inventario_portal i
        WHERE i.detectado_en = (SELECT max(detectado_en) FROM inventario_portal)
          AND i.rit_sin_letra = c.rit_sin_letra
      )
  ) END AS en_bd_no_vistas_en_portal
FROM v_conciliacion_detalle;

-- ------------------------------------------------------------
-- 6) BACKFILL HISTÓRICO: el primer número que verás será REAL, no "todo pendiente".
--    Usa bot_logs (1 fila por causa scrapeada) como evidencia de pasadas anteriores.
-- ------------------------------------------------------------
UPDATE causas c
SET
  ultima_escaneada  = sub.max_fecha,
  escaneos_totales  = sub.n_veces,
  escaneo_estado    = CASE WHEN sub.max_fecha IS NULL THEN 'pendiente'
                           WHEN sub.max_movs = 0      THEN 'sin_datos'
                           ELSE 'ok' END,
  pendientes_desde  = NULL
FROM (
  SELECT c2.id,
         MAX(bl.fecha_scraping)                AS max_fecha,
         COUNT(bl.id)                          AS n_veces,   -- COUNT(bl.id): sin logs = 0, no 1
         MAX(COALESCE(bl.movimientos_encontrados,0)) AS max_movs
  FROM causas c2
  LEFT JOIN bot_logs bl ON bl.causa_id = c2.id OR bl.rit = c2.rit
  GROUP BY c2.id
) sub
WHERE c.id = sub.id AND c.ultima_escaneada IS NULL;

-- Las nunca escaneadas heredan la antigüedad real de la causa (fecha de carga),
-- para que la cola ordenada refleje "pendiente desde", no "desde que existía la columna".
UPDATE causas SET pendientes_desde = created_at
WHERE escaneo_estado = 'pendiente' AND created_at IS NOT NULL;

-- Origen: lo que tiene columnas del Excel se marca 'excel'; el resto queda 'excel' por default
-- (revisar tras la migración única; el pegado nuevo escribirá 'asignada' explícitamente).

-- ------------------------------------------------------------
-- 7) PERMISOS: el panel (rol anon) tiene que leer las vistas de cobertura.
--    Supabase suele dar SELECT por defecto en el schema public, pero esto no es algo que
--    haya que suponer: si falta un grant el panel muestra "cobertura no disponible" y la
--    curadora se queda sin la métrica única. Explícito e idempotente.
-- ------------------------------------------------------------
ALTER TABLE bot_run_items     DISABLE ROW LEVEL SECURITY;
ALTER TABLE carga_lotes       DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_portal DISABLE ROW LEVEL SECURITY;

GRANT SELECT ON v_cobertura      TO anon, authenticated, service_role;
GRANT SELECT ON v_cola_escaneo   TO anon, authenticated, service_role;
GRANT SELECT ON v_run_activo     TO anon, authenticated, service_role;
GRANT SELECT ON v_causas_duplicadas TO anon, authenticated, service_role;
GRANT SELECT ON v_conciliacion         TO anon, authenticated, service_role;
GRANT SELECT ON v_conciliacion_detalle TO anon, authenticated, service_role;
-- El bot (con la key de servicio) escribe el rastro por causa y los lotes:
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_run_items     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON carga_lotes       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventario_portal TO service_role;

COMMIT;

-- ============================================================
-- ✅ VERIFICACIÓN (correr aparte, después del COMMIT)
--   SELECT * FROM v_cobertura;                       -- la métrica única
--   SELECT * FROM v_conciliacion;                    -- ¿están todas? (NULL = sin inventario)
--   SELECT rit, caratulado FROM v_conciliacion_detalle
--     WHERE situacion = 'falta_en_bd' LIMIT 50;      -- qué pegar en /asignaciones
--   SELECT count(*) FROM v_causas_duplicadas;        -- grupos a fusionar (ideal 0)
--   SELECT * FROM v_cola_escaneo LIMIT 25;           -- qué tomará el próximo lote
--   EXPLAIN ANALYZE SELECT * FROM v_cola_escaneo;    -- debe usar idx_causas_cola
-- ============================================================
