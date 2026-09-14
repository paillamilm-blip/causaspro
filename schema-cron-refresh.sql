-- CAUSASPRO - Refresco automático de la vista materializada (pg_cron)
-- Ejecutar en: SQL Editor de Supabase (proyecto de datos real)
-- ============================================================
--
-- QUÉ HACE:
-- La vista materializada mv_causas_ranking es una "foto" precalculada del semáforo.
-- Cuando el bot carga movimientos/audiencias nuevos, esa foto queda vieja hasta que
-- alguien la refresca. Este cron la refresca SOLA cada 15 minutos, así el dashboard
-- siempre muestra datos frescos sin que nadie corra SQL a mano.
--
-- REQUISITO: la extensión pg_cron (disponible en Supabase). Se habilita abajo.
-- La función refresh_ranking() ya existe (creada en schema-vista-materializada.sql).
-- ============================================================

-- 1. Habilitar pg_cron (idempotente; si ya está, no hace nada).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Quitar el job si ya existía (para poder re-ejecutar este script sin duplicar).
--    unschedule falla si el job no existe, por eso lo envolvemos en un DO seguro.
DO $$
BEGIN
  PERFORM cron.unschedule('refresh_causas_ranking');
EXCEPTION WHEN OTHERS THEN
  -- el job no existía todavía: ignorar.
  NULL;
END $$;

-- 3. Programar el refresco cada 15 minutos.
--    Usa REFRESH CONCURRENTLY (no bloquea las lecturas del dashboard).
SELECT cron.schedule(
  'refresh_causas_ranking',
  '*/15 * * * *',
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY mv_causas_ranking; $$
);

-- ✅ Verificar que quedó programado:
--   SELECT jobid, schedule, command, active FROM cron.job WHERE jobname = 'refresh_causas_ranking';
--
-- 🔎 Ver el historial de ejecuciones (últimas 10):
--   SELECT status, start_time, end_time FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'refresh_causas_ranking')
--   ORDER BY start_time DESC LIMIT 10;
--
-- ⏱️ Para cambiar la frecuencia: re-ejecutar el paso 3 con otro cron
--    (ej. '*/5 * * * *' = cada 5 min, '0 * * * *' = cada hora).
