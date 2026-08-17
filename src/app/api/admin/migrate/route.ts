import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Este endpoint solo muestra las instrucciones para migrar la vista
// El SQL debe ejecutarse manualmente en Supabase SQL Editor
export async function GET() {
  const sql = `
-- ============================================================
-- CAUSASPRO v2 - Vista mejorada de ranking con urgencia multi-criterio
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================

DROP VIEW IF EXISTS v_causas_ranking CASCADE;

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
    c.fecha_apertura,
    c.fecha_notificacion,
    c.updated_at,
    (SELECT COUNT(*) FROM nna n WHERE n.causa_id = c.id) AS total_nna,
    (SELECT string_agg(COALESCE(n.nombre,'') || ' ' || COALESCE(n.apellido,''), ' | ') 
     FROM nna n WHERE n.causa_id = c.id) AS nombres_nna,
    (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) AS proxima_audiencia,
    (SELECT EXTRACT(EPOCH FROM (MIN(a.fecha) - NOW())) / 86400.0
     FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) AS dias_para_audiencia,
    (SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id) AS ultima_audiencia,
    EXTRACT(EPOCH FROM (NOW() - GREATEST(
        c.updated_at, 
        COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)
    ))) / 86400.0 AS dias_sin_actividad,
    (SELECT MIN(mc.fecha_vencimiento) FROM medidas_cautelares mc 
     WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) AS proxima_medida_vence,
    (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc 
     WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) AS dias_medida_vence,
    (SELECT COUNT(*) > 0 FROM medidas_cautelares mc 
     WHERE mc.causa_id = c.id AND mc.vigente = TRUE) AS tiene_medida_vigente,
    (SELECT ad.nombre FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_nombre,
    (SELECT ad.telefono FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_telefono,
    CASE
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 2
        THEN 1
        WHEN (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc 
              WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) <= 7
        THEN 2
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 7
        THEN 3
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(
                c.updated_at, 
                COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)
             ))) / 86400.0 > 30
        THEN 4
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(
                c.updated_at, 
                COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)
             ))) / 86400.0 > 15
        THEN 5
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NULL
             AND c.estado IS NOT NULL AND c.estado NOT ILIKE '%archivada%' AND c.estado NOT ILIKE '%terminada%'
        THEN 6
        ELSE 10
    END AS nivel_urgencia
FROM causas c
ORDER BY 
    CASE
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 2
        THEN 1
        WHEN (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc 
              WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) <= 7
        THEN 2
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 7
        THEN 3
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(
                c.updated_at, 
                COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)
             ))) / 86400.0 > 30
        THEN 4
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(
                c.updated_at, 
                COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)
             ))) / 86400.0 > 15
        THEN 5
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NULL
             AND c.estado IS NOT NULL AND c.estado NOT ILIKE '%archivada%' AND c.estado NOT ILIKE '%terminada%'
        THEN 6
        ELSE 10
    END ASC,
    c.updated_at DESC;
  `.trim()

  return NextResponse.json({
    instrucciones: 'Copia y pega el SQL de abajo en el SQL Editor de Supabase y haz click en RUN',
    url: 'https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new',
    sql,
  })
}
