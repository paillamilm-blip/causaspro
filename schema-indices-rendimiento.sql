-- CAUSASPRO - Índices de rendimiento para acelerar v_causas_ranking
-- Ejecutar en: SQL Editor de Supabase (proyecto de datos real)
-- ============================================================
--
-- PROBLEMA que resuelve:
-- La vista v_causas_ranking hace ~20 subqueries correlacionados por fila
-- (movimientos, audiencias, medidas_cautelares, nna, adultos) × 647 filas =
-- ~13.000 ejecuciones de subquery por request. Desde el rol `anon` (el del
-- navegador) esa consulta supera el statement_timeout (~8s) y lanza el error
-- 57014 → el dashboard cae al fallback y muestra TODO como "Estable".
--
-- CAUSA CONCRETA principal: la tabla medidas_cautelares NO tenía NINGÚN índice.
-- La vista la consulta 3 veces por fila con WHERE causa_id = c.id → 647 × 3
-- ≈ 1.900 seq-scans completos de la tabla. Todas las demás tablas del join
-- (nna, adultos, audiencias, movimientos) ya tienen índice en causa_id.
--
-- Estos índices hacen que cada subquery correlacionado use un index scan en
-- vez de un seq-scan, bajando el tiempo de la vista por debajo del timeout.
-- Aditivo e idempotente (IF NOT EXISTS): no toca datos ni estructura.
-- ============================================================

-- 🔴 EL FALTANTE CRÍTICO: medidas_cautelares no tenía índice en causa_id.
-- Índice parcial sobre las medidas vigentes (que es lo que filtra la vista).
CREATE INDEX IF NOT EXISTS idx_medidas_causa
  ON medidas_cautelares(causa_id);

CREATE INDEX IF NOT EXISTS idx_medidas_vigente_venc
  ON medidas_cautelares(causa_id, fecha_vencimiento)
  WHERE vigente = TRUE;

-- Índices compuestos (causa_id, fecha) para acelerar los MIN(fecha)/MAX(fecha)
-- correlacionados. Con estos, el subquery encuentra el mínimo/máximo por causa
-- usando el índice, sin escanear todos los movimientos/audiencias de la causa.
CREATE INDEX IF NOT EXISTS idx_movimientos_causa_fecha
  ON movimientos(causa_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_audiencias_causa_fecha
  ON audiencias(causa_id, fecha);

-- ✅ Después de correr esto, la vista debería responder en milisegundos también
--    para el rol anon. Verificar tiempo con:
--    EXPLAIN ANALYZE SELECT * FROM v_causas_ranking;
--    (el "Execution Time" debería ser < 1000 ms)
