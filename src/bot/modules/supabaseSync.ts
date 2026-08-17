// ============================================================
// CAUSASPRO BOT - Supabase Sync Module
// Sincroniza datos scrapeados con la base de datos
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { CausaScrapedData, CausaToScrape, BotRunStatus } from '../types'
import type { UrgencyAnalysis } from './detection'
import { log } from '../utils'

let supabase: SupabaseClient | null = null

/**
 * Inicializa el cliente de Supabase
 */
export function initSupabase(): SupabaseClient {
  if (supabase) return supabase
  
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!url || !key) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son requeridas')
  }
  
  supabase = createClient(url, key)
  return supabase
}

/**
 * Obtiene las causas a scrapear, priorizando las más urgentes
 */
export async function getCausasToScrape(limit: number, priorizarUrgentes: boolean): Promise<CausaToScrape[]> {
  const sb = initSupabase()
  
  let query = sb
    .from('causas')
    .select('id, rit')
    .not('rit', 'is', null)
  
  if (priorizarUrgentes) {
    // Priorizar causas que no se han actualizado recientemente
    query = query.order('updated_at', { ascending: true })
  }
  
  const { data, error } = await query.limit(limit)
  
  if (error) {
    log('error', `Error obteniendo causas: ${error.message}`)
    return []
  }
  
  return (data || []).map(c => ({
    id: c.id,
    rit: c.rit,
  }))
}

/**
 * Guarda los datos scrapeados de una causa
 */
export async function saveCausaData(data: CausaScrapedData, analysis: UrgencyAnalysis): Promise<boolean> {
  const sb = initSupabase()
  
  try {
    // 1. Actualizar estado de la causa
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }
    
    if (data.estado_actual) {
      updateData.estado = data.estado_actual
    }
    
    const { error: updateErr } = await sb
      .from('causas')
      .update(updateData)
      .eq('id', data.causa_id)
    
    if (updateErr) {
      log('error', `Error actualizando causa ${data.rit}: ${updateErr.message}`)
    }
    
    // 2. Insertar movimientos nuevos
    if (data.movimientos.length > 0) {
      await syncMovimientos(sb, data)
    }
    
    // 3. Insertar/actualizar audiencias
    if (data.audiencias.length > 0) {
      await syncAudiencias(sb, data)
    }
    
    // 4. Guardar log del bot
    await saveBotLog(sb, data, analysis)
    
    return true
    
  } catch (error: any) {
    log('error', `Error guardando datos de ${data.rit}: ${error.message}`)
    return false
  }
}

/**
 * Sincroniza movimientos (solo inserta nuevos, evita duplicados)
 */
async function syncMovimientos(sb: SupabaseClient, data: CausaScrapedData): Promise<void> {
  // Obtener movimientos existentes para evitar duplicados
  const { data: existing } = await sb
    .from('movimientos')
    .select('fecha, tramite')
    .eq('causa_id', data.causa_id)
  
  const existingSet = new Set(
    (existing || []).map(m => `${m.fecha}|${m.tramite}`)
  )
  
  // Filtrar solo movimientos nuevos
  const nuevos = data.movimientos.filter(m => {
    const key = `${m.fecha}|${m.tramite}`
    return !existingSet.has(key)
  })
  
  if (nuevos.length === 0) return
  
  // Insertar en lotes
  const records = nuevos.map(m => ({
    causa_id: data.causa_id,
    fecha: m.fecha,
    etapa: m.etapa || null,
    tramite: m.tramite,
    descripcion: m.descripcion || null,
    es_traslado_curador: m.es_traslado_curador,
    fuente: 'pjud_bot',
  }))
  
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100)
    const { error } = await sb.from('movimientos').insert(batch)
    if (error) {
      log('warn', `Error insertando movimientos de ${data.rit}: ${error.message}`)
    }
  }
  
  log('info', `  +${nuevos.length} movimientos nuevos para ${data.rit}`)
}

/**
 * Sincroniza audiencias (inserta nuevas, actualiza existentes)
 */
async function syncAudiencias(sb: SupabaseClient, data: CausaScrapedData): Promise<void> {
  // Obtener audiencias existentes
  const { data: existing } = await sb
    .from('audiencias')
    .select('id, fecha, tipo')
    .eq('causa_id', data.causa_id)
  
  const existingMap = new Map(
    (existing || []).map(a => [`${a.fecha}|${a.tipo}`, a.id])
  )
  
  // Separar en nuevas y existentes
  const nuevas = data.audiencias.filter(a => {
    const key = `${a.fecha}|${a.tipo}`
    return !existingMap.has(key)
  })
  
  if (nuevas.length > 0) {
    const records = nuevas.map(a => ({
      causa_id: data.causa_id,
      fecha: a.fecha,
      tipo: a.tipo,
      notas: a.estado ? `Estado: ${a.estado}${a.sala ? ` | Sala: ${a.sala}` : ''}` : null,
    }))
    
    const { error } = await sb.from('audiencias').insert(records)
    if (error) {
      log('warn', `Error insertando audiencias de ${data.rit}: ${error.message}`)
    } else {
      log('info', `  +${nuevas.length} audiencias nuevas para ${data.rit}`)
    }
  }
}

/**
 * Guarda log de ejecución del bot
 */
async function saveBotLog(sb: SupabaseClient, data: CausaScrapedData, analysis: UrgencyAnalysis): Promise<void> {
  try {
    await sb.from('bot_logs').insert({
      causa_id: data.causa_id,
      rit: data.rit,
      fecha_scraping: data.fecha_scraping,
      movimientos_encontrados: data.movimientos.length,
      audiencias_encontradas: data.audiencias.length,
      resoluciones_encontradas: data.resoluciones.length,
      tiene_traslado_curador: data.tiene_traslado_curador,
      nivel_urgencia: analysis.nivel_urgencia,
      motivos: analysis.motivos,
      error: data.error || null,
    })
  } catch {
    // No fallar si la tabla de logs no existe aún
  }
}

/**
 * Guarda el estado de una ejecución del bot
 */
export async function saveBotRunStatus(status: BotRunStatus): Promise<void> {
  const sb = initSupabase()
  
  try {
    await sb.from('bot_runs').insert({
      run_id: status.run_id,
      started_at: status.started_at,
      finished_at: status.finished_at,
      total_causas: status.total_causas,
      procesadas: status.procesadas,
      exitosas: status.exitosas,
      fallidas: status.fallidas,
      detenido_por: status.detenido_por,
      errores: status.errores,
    })
  } catch {
    // No fallar si la tabla no existe
    log('warn', 'No se pudo guardar estado del bot (tabla bot_runs no existe)')
  }
}

/**
 * Marca una causa como "última vez scrapeada"
 */
export async function markCausaScraped(causaId: string): Promise<void> {
  const sb = initSupabase()
  
  await sb
    .from('causas')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', causaId)
}
