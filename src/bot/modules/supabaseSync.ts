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


// ============================================================
// BOT_FIX_LETRAS — corrección de la letra/tipo del RIT contra el portal
// ------------------------------------------------------------
// Estas funciones son EXCLUSIVAS del modo BOT_FIX_LETRAS y NO participan del
// flujo normal de scraping (rit/listado). Filosofía: NUNCA inventar la letra —
// la fuente de verdad es lo que el portal PJUD devuelve en la fila de resultados.
// ============================================================

/** Una causa candidata a revisión de letra: id, su RIT en BD y su tipo actual. */
export interface CausaParaFixLetra {
  id: string
  rit: string
  tipo: string | null
}

/**
 * Trae causas para revisar/corregir su letra, en modo BOT_FIX_LETRAS.
 * PRIORIZA las causas con tipo NULL (las que el Excel trajo SIN letra, ej. "4596-2024"),
 * porque son las que más se benefician de que el portal les confirme la letra real.
 * Trae también el resto (letra posiblemente equivocada) después, hasta `limit`.
 * A diferencia de getCausasToScrape, este SÍ trae `tipo` (necesario para comparar).
 */
export async function getCausasToFixLetras(limit: number): Promise<CausaParaFixLetra[]> {
  const sb = initSupabase()

  // 1) Primero las que NO tienen tipo (sin letra) — máxima prioridad.
  const sinTipo = await sb
    .from('causas')
    .select('id, rit, tipo')
    .not('rit', 'is', null)
    .is('tipo', null)
    .order('updated_at', { ascending: true })
    .limit(limit)

  if (sinTipo.error) {
    log('error', `Error obteniendo causas sin tipo: ${sinTipo.error.message}`)
    return []
  }

  const acumuladas: CausaParaFixLetra[] = (sinTipo.data || []).map(c => ({
    id: c.id, rit: c.rit, tipo: c.tipo ?? null,
  }))

  // 2) Si aún hay cupo, completar con causas que SÍ tienen tipo (para verificar/corregir).
  const resto = limit - acumuladas.length
  if (resto > 0) {
    const conTipo = await sb
      .from('causas')
      .select('id, rit, tipo')
      .not('rit', 'is', null)
      .not('tipo', 'is', null)
      .order('updated_at', { ascending: true })
      .limit(resto)

    if (!conTipo.error) {
      for (const c of conTipo.data || []) {
        acumuladas.push({ id: c.id, rit: c.rit, tipo: c.tipo ?? null })
      }
    }
  }

  return acumuladas.slice(0, limit)
}

/**
 * Actualiza el RIT y el tipo de una causa existente (por id) con los valores REALES
 * leídos del portal. Fail-safe ante colisión de RIT: si el `nuevoRit` YA pertenece a
 * OTRA causa distinta en la BD, NO pisa nada y devuelve 'colision_rit' (evita fusionar
 * dos expedientes bajo el mismo RIT). Devuelve el resultado para que el orquestador lo
 * loguee/cuente honestamente.
 */
export async function updateCausaRitYTipo(
  id: string,
  nuevoRit: string,
  nuevoTipo: string | null,
): Promise<'actualizado' | 'colision_rit' | 'error'> {
  const sb = initSupabase()
  try {
    // ¿El nuevoRit ya lo tiene OTRA causa? (integridad: rit debería ser único por causa)
    const { data: choque, error: qErr } = await sb
      .from('causas')
      .select('id')
      .eq('rit', nuevoRit)
      .neq('id', id)
      .limit(1)
    if (qErr) {
      log('warn', `  No se pudo verificar colisión de RIT para ${nuevoRit}: ${qErr.message}`)
      return 'error'
    }
    if (choque && choque.length > 0) {
      return 'colision_rit'
    }

    const { error } = await sb
      .from('causas')
      .update({ rit: nuevoRit, tipo: nuevoTipo, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      log('warn', `  Error actualizando RIT/tipo de la causa ${id}: ${error.message}`)
      return 'error'
    }
    return 'actualizado'
  } catch (e: any) {
    log('warn', `  Excepción actualizando RIT/tipo de ${id}: ${e?.message ?? e}`)
    return 'error'
  }
}

/**
 * Deja una marca de "revisar letra manualmente" en el campo `notas` de la causa, SIN
 * tocar rit/tipo. Se usa cuando el portal devuelve AMBIGÜEDAD (mismo número+año con
 * varias letras distintas): no adivinamos, marcamos para revisión humana.
 * Es idempotente-ish: no duplica la marca si ya está presente.
 */
export async function marcarRevisionLetra(id: string, detalle: string): Promise<void> {
  const sb = initSupabase()
  try {
    const { data } = await sb.from('causas').select('notas').eq('id', id).limit(1)
    const notasActuales: string = (data && data[0]?.notas) || ''
    const marca = `[REVISAR LETRA] ${detalle}`
    if (notasActuales.includes('[REVISAR LETRA]')) return // ya marcada
    const nuevasNotas = notasActuales ? `${notasActuales}\n${marca}` : marca
    await sb.from('causas').update({ notas: nuevasNotas, updated_at: new Date().toISOString() }).eq('id', id)
  } catch (e: any) {
    log('warn', `  No se pudo marcar revisión de letra para ${id}: ${e?.message ?? e}`)
  }
}
