// ============================================================
// CAUSASPRO BOT - Supabase Sync Module
// Sincroniza datos scrapeados con la base de datos
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { CausaScrapedData, CausaToScrape, BotRunStatus, BotStepMetric } from '../types'
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
      paso: data.error ? 'scrape' : 'ok',
    })
  } catch {
    // No fallar si la tabla de logs no existe aún
  }
}

/**
 * QA / Trazabilidad: registra un ERROR del bot con el paso donde ocurrió y la
 * ruta de la screenshot. Sirve para no repetir el mismo error y depurar rápido.
 * No lanza excepción si la tabla no existe (falla en silencio).
 *
 * @param paso            Etapa del flujo: 'login' | 'navegacion' | 'search' | 'detalle' | 'scrape' | 'critico'
 * @param error           Mensaje de error
 * @param opts.rit        RIT de la causa afectada (si aplica)
 * @param opts.causaId    UUID de la causa (si aplica)
 * @param opts.runId      ID de la sesión del bot (para agrupar logs)
 * @param opts.screenshotPath Ruta del screenshot capturado en el fallo
 */
export async function saveBotError(
  paso: string,
  error: string,
  opts: { rit?: string; causaId?: string; runId?: string; screenshotPath?: string } = {}
): Promise<void> {
  try {
    const sb = initSupabase()
    await sb.from('bot_logs').insert({
      causa_id: opts.causaId || null,
      rit: opts.rit || null,
      fecha_scraping: new Date().toISOString(),
      error: error?.slice(0, 2000) || 'error desconocido',
      paso,
      screenshot_path: opts.screenshotPath || null,
      run_id: opts.runId || null,
    })
  } catch {
    // No fallar si la tabla/columnas no existen aún
  }
}

/**
 * Guarda el estado de una ejecución del bot, incluyendo las métricas de
 * auto-aprendizaje (duración, velocidad, tasa de éxito).
 *
 * Robustez: si las columnas nuevas todavía no existen en la BD (no se corrió
 * schema-bot-aprendizaje.sql), reintenta el insert solo con las columnas base
 * para no perder el registro de la sesión.
 */
export async function saveBotRunStatus(status: BotRunStatus): Promise<void> {
  const sb = initSupabase()

  const base = {
    run_id: status.run_id,
    started_at: status.started_at,
    finished_at: status.finished_at,
    total_causas: status.total_causas,
    procesadas: status.procesadas,
    exitosas: status.exitosas,
    fallidas: status.fallidas,
    detenido_por: status.detenido_por,
    errores: status.errores,
  }

  // Columnas de aprendizaje (pueden no existir aún)
  const conMetricas = {
    ...base,
    duracion_ms: status.duracion_ms ?? null,
    causas_por_min: status.causas_por_min ?? null,
    tasa_exito: status.tasa_exito ?? null,
    search_mode: status.search_mode ?? null,
    bloqueo_detectado: status.bloqueo_detectado ?? false,
  }

  const { error } = await sb.from('bot_runs').insert(conMetricas)
  if (!error) return

  // Solo degradamos a "columnas base" si el error es COLUMNA INEXISTENTE (Postgres 42703),
  // es decir, todavía no se corrió schema-bot-aprendizaje.sql. Cualquier otro error
  // (constraint, red, etc.) se reporta con su mensaje real — no lo ocultamos.
  const esColumnaFaltante = (error as any)?.code === '42703'
  if (!esColumnaFaltante) {
    log('warn', `No se pudo guardar estado del bot: ${error.message}`)
    return
  }

  const { error: baseErr } = await sb.from('bot_runs').insert(base)
  if (baseErr) {
    log('warn', `No se pudo guardar estado del bot (columnas base): ${baseErr.message}`)
  } else {
    log('warn', 'bot_runs guardado sin métricas nuevas (corré schema-bot-aprendizaje.sql para habilitarlas)')
  }
}

/**
 * Registra la métrica de una ETAPA del flujo (una fila en bot_step_metrics).
 * Es el núcleo del "aprendizaje": permite ver dónde se va el tiempo y dónde
 * falla más el bot. Falla en silencio si la tabla no existe todavía.
 */
export async function saveStepMetric(metric: BotStepMetric): Promise<void> {
  try {
    const sb = initSupabase()
    await sb.from('bot_step_metrics').insert({
      run_id: metric.run_id,
      rit: metric.rit ?? null,
      paso: metric.paso,
      duracion_ms: metric.duracion_ms,
      exito: metric.exito,
      tipo_error: metric.tipo_error ?? null,
    })
  } catch {
    // No fallar si la tabla bot_step_metrics no existe aún
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
