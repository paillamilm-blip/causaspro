-- ============================================================
-- CAUSASPRO v2 - Vista mejorada de ranking con urgencia multi-criterio
-- Ejecutar en: https://supabase.com/dashboard/project/ggwpikokzhckjpwyltye/sql/new
-- ============================================================

-- Eliminar vista anterior
DROP VIEW IF EXISTS v_causas_ranking CASCADE;

-- ============================================================
-- NUEVA VISTA: Ranking multi-criterio
-- Criterios de urgencia:
--   1. Audiencia futura cercana (si existe)
--   2. Medida cautelar por vencer
--   3. Días sin actividad (updated_at)
--   4. Días desde notificación sin audiencia programada
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
    c.fecha_apertura,
    c.fecha_notificacion,
    c.updated_at,
    
    -- Contar NNA
    (SELECT COUNT(*) FROM nna n WHERE n.causa_id = c.id) AS total_nna,
    
    -- Nombres NNA
    (SELECT string_agg(COALESCE(n.nombre,'') || ' ' || COALESCE(n.apellido,''), ' | ') 
     FROM nna n WHERE n.causa_id = c.id) AS nombres_nna,
    
    -- Próxima audiencia (futuras)
    (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) AS proxima_audiencia,
    
    -- Días para próxima audiencia
    (SELECT EXTRACT(EPOCH FROM (MIN(a.fecha) - NOW())) / 86400.0
     FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) AS dias_para_audiencia,
    
    -- Última audiencia (pasada - para medir inactividad)
    (SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id) AS ultima_audiencia,
    
    -- Días desde última actividad (menor entre updated_at y última audiencia)
    EXTRACT(EPOCH FROM (NOW() - GREATEST(
        c.updated_at, 
        COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)
    ))) / 86400.0 AS dias_sin_actividad,
    
    -- Medida cautelar más próxima a vencer
    (SELECT MIN(mc.fecha_vencimiento) FROM medidas_cautelares mc 
     WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) AS proxima_medida_vence,
    
    -- Días para vencimiento de medida
    (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc 
     WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) AS dias_medida_vence,
    
    -- Tiene medida cautelar vigente
    (SELECT COUNT(*) > 0 FROM medidas_cautelares mc 
     WHERE mc.causa_id = c.id AND mc.vigente = TRUE) AS tiene_medida_vigente,
    
    -- Adulto responsable
    (SELECT ad.nombre FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_nombre,
    (SELECT ad.telefono FROM adultos ad WHERE ad.causa_id = c.id LIMIT 1) AS adulto_telefono,
    
    -- ============================================================
    -- SCORE DE URGENCIA (0 = más urgente)
    -- Combina todos los criterios
    -- ============================================================
    CASE
        -- Criterio 1: Audiencia en ≤2 días → máxima urgencia
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 2
        THEN 1
        
        -- Criterio 2: Medida cautelar vence en ≤7 días
        WHEN (SELECT MIN(mc.fecha_vencimiento) - CURRENT_DATE FROM medidas_cautelares mc 
              WHERE mc.causa_id = c.id AND mc.vigente = TRUE AND mc.fecha_vencimiento >= CURRENT_DATE) <= 7
        THEN 2
        
        -- Criterio 3: Audiencia en ≤7 días
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NOT NULL
             AND EXTRACT(EPOCH FROM ((SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) - NOW())) / 86400.0 <= 7
        THEN 3
        
        -- Criterio 4: Sin actividad > 30 días (inactivas = peligro)
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(
                c.updated_at, 
                COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)
             ))) / 86400.0 > 30
        THEN 4
        
        -- Criterio 5: Sin actividad > 15 días
        WHEN EXTRACT(EPOCH FROM (NOW() - GREATEST(
                c.updated_at, 
                COALESCE((SELECT MAX(a.fecha) FROM audiencias a WHERE a.causa_id = c.id), c.updated_at)
             ))) / 86400.0 > 15
        THEN 5
        
        -- Criterio 6: Sin audiencia programada y causa activa
        WHEN (SELECT MIN(a.fecha) FROM audiencias a WHERE a.causa_id = c.id AND a.fecha >= NOW()) IS NULL
             AND c.estado IS NOT NULL AND c.estado NOT ILIKE '%archivada%' AND c.estado NOT ILIKE '%terminada%'
        THEN 6
        
        -- El resto: estables
        ELSE 10
    END AS nivel_urgencia

FROM causas c
ORDER BY 
    -- Ordenar por nivel de urgencia (menor = más urgente)
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

-- ✅ Vista actualizada con urgencia multi-criterio
