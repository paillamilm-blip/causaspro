// ============================================================
// CAUSASPRO BOT - Supabase Sync Module
// Sincroniza datos scrapeados con la base de datos
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { CausaScrapedData, CausaToScrape, BotRunStatus, BotStepMetric } from '../types'
import type { UrgencyAnalysis } from './detection'
import { log, TIPOS_RIT_VALIDOS, parseRIT } from '../utils'

/**
 * Deriva { rol, anio } (identidad estable, enteros) de un RIT usando parseRIT.
 * rol sin ceros a la izquierda. Devuelve {} si el rit no parsea.
 */
function rolAnioDeRit(rit: string): { rol: number | null; anio: number | null } {
  const p = parseRIT(rit)
  if (!p) return { rol: null, anio: null }
  const rol = parseInt(p.numero, 10)
  const anio = parseInt(p.año, 10)
  return {
    rol: Number.isFinite(rol) ? rol : null,
    anio: Number.isFinite(anio) ? anio : null,
  }
}

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

/** Marca que se pone en `notas` cuando una causa NO aparece en el portal (ruido/archivada
 *  de otra competencia). Sirve para NO reintentarla en cada tanda. */
const MARCA_NO_EN_PORTAL = '[NO EN PORTAL]'
/** Marca de CUARENTENA revisable: el bot no pudo scrapear la causa tras N fallos transitorios
 *  seguidos. La saca del loop (no atasca tandas) pero, a diferencia de [NO EN PORTAL], NO afirma
 *  que la causa no exista → queda visible para revisión manual (nunca perder una causa real). */
const MARCA_REVISAR = '[REVISAR: no scrapeada]'
/** Marca que deja marcarRevisionLetra: el RIT de la base NO coincide con el del portal
 *  (mismo número+año, otra letra), o el portal fue ambiguo. Buscar la causa tal cual nunca
 *  va a funcionar, así que también sale de la cola: necesita una decisión humana, no más
 *  reintentos. OJO: es distinta de MARCA_REVISAR y no se solapa en el includes(). */
const MARCA_REVISAR_LETRA = '[REVISAR LETRA]'
/** Marca MANUAL de la curadora: la causa terminó, sacarla de monitoreo. El portal no informa
 *  el cierre (verificado: `estado` dice "Sin Estado" y los movimientos no traen vocabulario de
 *  término), así que esta marca es la única fuente y manda. Definida en src/lib/monitoreo.ts;
 *  acá se copia el literal para no importar src/lib desde el bot y mantener los dos lados
 *  desacoplados — si cambia allá, cambiar acá (hay un test que verifica que coincidan). */
const MARCA_TERMINADA = '[TERMINADA]'

// ============================================================
// ESTADO DE ESCANEO (cola oficial — schema-001-cobertura.sql)
// ------------------------------------------------------------
// Desde la migración, `causas.escaneo_estado` es la fuente de verdad de
// "¿cuántas faltan?": pendiente | ok | sin_datos | error | descatalogada.
// Las marcas en `notas` siguen existiendo (son contexto humano-legible), pero
// la SELECCIÓN de lote pasa a mirar el estado. Todo este bloque es fail-safe:
// si la migración todavía no se corrió (columnas inexistentes, Postgres 42703),
// las escrituras se ignoran en silencio y el flujo viejo sigue funcionando.
// ============================================================

export type EscaneoEstado = 'pendiente' | 'en_progreso' | 'ok' | 'sin_datos' | 'error' | 'descatalogada'

/**
 * Escribe el estado de escaneo de una causa. `contarScan=true` suma al contador
 * y fija ultima_escaneada (se usa al terminar un intento de scrapeo real).
 * Lee el contador actual primero; es best-effort, nunca rompe la corrida.
 */
export async function setEscaneoEstado(
  causaId: string,
  estado: EscaneoEstado,
  opts: { runId?: string; contarScan?: boolean } = {},
): Promise<void> {
  const sb = initSupabase()
  try {
    const update: Record<string, any> = { escaneo_estado: estado }
    if (opts.contarScan) {
      update.ultima_escaneada = new Date().toISOString()
      const { data } = await sb.from('causas').select('escaneos_totales').eq('id', causaId).limit(1)
      const previos = (data && data[0]?.escaneos_totales) ?? 0
      update.escaneos_totales = (parseInt(previos, 10) || 0) + 1
    }
    if (opts.runId) update.ultima_run_id = opts.runId
    const { error } = await sb.from('causas').update(update).eq('id', causaId)
    if (error && (error as any).code !== '42703') {
      log('warn', `  No se pudo actualizar escaneo_estado de ${causaId}: ${error.message}`)
    }
  } catch {
    // silencioso a propósito: la trazabilidad de cola no puede tumbar el scrapeo
  }
}

/**
 * Deja rastro POR CAUSA de lo que una corrida hizo (o intentó). Es lo que permite
 * responder "¿el lote anterior avanzó o repitió?" y alimentar el progreso en vivo.
 */
export async function logRunItem(
  runId: string,
  causaId: string | null,
  rit: string,
  resultado: 'ok' | 'sin_movimientos' | 'no_encontrada' | 'error' | 'no_intentada',
  movimientosNuevos = 0,
  error?: string,
): Promise<void> {
  const sb = initSupabase()
  try {
    const { error: e } = await sb.from('bot_run_items').insert({
      run_id: runId,
      causa_id: causaId,
      rit,
      resultado,
      movimientos_nuevos: movimientosNuevos,
      error: error ? String(error).slice(0, 2000) : null,
    })
    if (e && (e as any).code !== '42P01') {
      log('warn', `  No se pudo registrar bot_run_item ${rit}: ${e.message}`)
    }
  } catch {
    // tabla inexistente (migración pendiente) → ignorar
  }
}

/**
 * Progreso en VIVO de la corrida: upsert de bot_runs sobre run_id (único) en lugar
 * de esperar al insert final. El dashboard hace polling de esto.
 */
export async function upsertBotRunProgreso(status: BotRunStatus): Promise<void> {
  const sb = initSupabase()
  try {
    const { error } = await sb
      .from('bot_runs')
      .upsert(
        {
          run_id: status.run_id,
          started_at: status.started_at,
          total_causas: status.total_causas,
          procesadas: status.procesadas,
          exitosas: status.exitosas,
          fallidas: status.fallidas,
        },
        { onConflict: 'run_id' },
      )
    if (error && (error as any).code !== '42P10') {
      log('warn', `  Progreso de run no guardado: ${error.message}`)
    }
  } catch {
    // silencioso: el registro final (saveBotRunStatus) sigue cubriendo la corrida
  }
}

/** Refresca el ranking al terminar la corrida: mata los 15 min de latencia del cron. */
export async function refrescarRanking(): Promise<void> {
  const sb = initSupabase()
  try {
    const { error } = await sb.rpc('refresh_ranking')
    if (error) log('warn', `  refresh_ranking(): ${error.message}`)
  } catch {
    // función inexistente → el pg_cron de 15 min sigue cubriendo
  }
}

/**
 * RECUPERACIÓN de la cola: si una corrida anterior murió (CTRL+C, corte de luz, navegador
 * tumbado) dejó causas en 'en_progreso' que nadie va a cerrar, y 'en_progreso' NO está en
 * la cola de selección → esas causas quedarían invisible para siempre. Al arrancar, antes
 * de armar el lote, se devuelven a 'pendiente'.
 *
 * Se hace en dos pasos (leer ids → filtrar en JS → update masivo) en vez de un `.or()` de
 * PostgREST porque el `run_id` va dentro del filtro y los filtros OR con valores arbitrarios
 * se rompen con puntos y comas.
 */
export async function reclamarColaAbandonada(runId: string): Promise<number> {
  const sb = initSupabase()
  try {
    const { data: colgadas, error } = await sb
      .from('causas')
      .select('id, ultima_run_id')
      .eq('escaneo_estado', 'en_progreso')
      .limit(1000)
    if (error) {
      if ((error as any).code !== '42703') log('warn', `  No se pudo leer la cola en_progreso: ${error.message}`)
      return 0
    }
    const aReclamar = (colgadas || [])
      .filter(c => ((c as any).ultima_run_id ?? null) !== runId)
      .map(c => c.id as string)
    if (aReclamar.length === 0) return 0
    return updatePorIdEnBloques(aReclamar, { escaneo_estado: 'pendiente' })
  } catch {
    return 0
  }
}

/**
 * UPDATE por `id` en bloques de 100. PostgREST manda el filtro `id=in(...)` en la URL: con
 * 2000 UUID son ~76 KB de query string y la pasarela (Supabase/Vercel) corta el request con
 * un error confuso ("something failed" sin mensaje). De a 100 va bien y falla poco.
 */
async function updatePorIdEnBloques(
  ids: string[],
  payload: Record<string, unknown>,
): Promise<number> {
  const sb = initSupabase()
  let ok = 0
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100)
    const { data, error } = await sb.from('causas').update(payload).in('id', lote).select('id')
    if (error) {
      if ((error as any).code === '42703') return ok // columna aún no existe: nada por hacer
      log('warn', `  Update por bloques falló (${lote.length} causas): ${error.message}`)
      continue
    }
    ok += (data || []).length
  }
  return ok
}

/**
 * REVITALIZAR la cola: una causa 'ok' no vuelve a 'pendiente' por sí sola nunca, así que
 * sin este paso la cola se vacía y el panel dice "0 pendientes" para siempre... aunque los
 * movimientos del portal sigan avanzando. Justo ahí es donde se pierde una audiencia o un
 * traslado.
 *
 * Este paso re-encola las 'ok'/'sin_datos' cuyo último escaneo es más viejo que
 * BOT_DIAS_RENOVACION (7 por defecto). Con la cola actualizada:
 *   · 'pendientes' en el panel vuelve a ser verdad ("causas que falta traer"),
 *   · v_cola_escaneo y la selección del bot coinciden (mismo criterio en los dos lados),
 *   · el refresco periódico sigue pasando como siempre, solo que ahora es visible.
 */
export async function reencolarVencidas(dias = Number(process.env.BOT_DIAS_RENOVACION || 7)): Promise<number> {
  const sb = initSupabase()
  try {
    const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await sb
      .from('causas')
      .select('id, notas')
      .in('escaneo_estado', ['ok', 'sin_datos'])
      .lt('ultima_escaneada', corte)
      .limit(2000)
    if (error) {
      // 42703 = columna aún no existe (migración sin aplicar): silencio, el legacy alcanza.
      if ((error as any).code !== '42703') log('warn', `  No se pudieron leer las causas vencidas: ${error.message}`)
      return 0
    }
    // Mismo filtro de ruido que usa la selección: si una causa [NO EN PORTAL] o [TERMINADA]
    // pasara a 'pendiente', el panel la contaría como pendiente y el bot se negaría a
    // procesarla para siempre.
    const ids = (data || [])
      .filter((c: any) => {
        const n: string = c.notas || ''
        return !n.includes(MARCA_NO_EN_PORTAL) && !n.includes(MARCA_REVISAR)
          && !n.includes(MARCA_REVISAR_LETRA) && !n.includes(MARCA_TERMINADA)
      })
      .map((c: any) => c.id as string)
    if (ids.length === 0) return 0
    return updatePorIdEnBloques(ids, { escaneo_estado: 'pendiente' })
  } catch {
    return 0
  }
}

// ------------------------------------------------------------
// MODO INVENTARIO (conciliación portal ↔ base de datos)
// ------------------------------------------------------------

/** Una fila leída del listado "Mis Causas > Familia" del portal. */
export interface FilaInventario {
  rit: string
  caratulado?: string | null
  estado_procesal?: string | null
}

/**
 * Normaliza un RIT quitándole la LETRA (solo número-año). Es la comparación honesta para
 * conciliar: la letra es la parte menos fiable del dato (P↔X vinculadas, causas que cambian
 * de materia) y los RIT de la curadora muchas veces se anotan sin letra.
 *
 * ⚠️ Debe coincidir con la columna generada `rit_sin_letra` de schema-001-cobertura.sql.
 */
export function ritSinLetra(rit: string): string {
  return (rit || '').toUpperCase().replace(/\s+/g, '').replace(/[^0-9-]/g, '')
    .replace(/^-+/, '').replace(/-+$/, '')
}

/**
 * Escribe el inventario del portal. `corridaEn` es el MISMO timestamp para todas las filas
 * de una corrida: es lo que las agrupa y lo que define cuál es "el último inventario".
 *
 * NO llamarlo si el barrido quedó incompleto (corte por horario, límite o sesión perdida):
 * un inventario parcial se leería como "estas causas ya no están en el portal" y marcaría
 * desapariciones falsas. Es mejor no escribir nada ese día.
 *
 * @returns false si no se pudo escribir (tabla sin crear, error de la BD).
 */
export async function guardarInventarioPortal(
  filas: FilaInventario[],
  corridaEn: string,
): Promise<boolean> {
  const sb = initSupabase()

  const unicos = new Map<string, FilaInventario>()
  for (const f of filas) {
    const rit = (f.rit || '').trim().toUpperCase()
    if (rit && !unicos.has(rit)) unicos.set(rit, { ...f, rit })
  }

  const registros = Array.from(unicos.values()).map(f => {
    const p = parseRIT(f.rit)
    return {
      rit: f.rit,
      rol: p ? Number(p.numero) : null,
      anio: p ? Number(p.año) : null,
      caratulado: f.caratulado ?? null,
      estado_portal: f.estado_procesal ?? null,
      detectado_en: corridaEn,
    }
  })
  if (registros.length === 0) return false

  for (let i = 0; i < registros.length; i += 200) {
    const lote = registros.slice(i, i + 200)
    const { error } = await sb.from('inventario_portal')
      .upsert(lote, { onConflict: 'rit,detectado_en' })
    if (error) {
      if ((error as any).code === '42P01') {
        log('warn', '  No existe la tabla inventario_portal: ejecutá schema-001-cobertura.sql en Supabase para habilitar el modo inventario.')
      } else {
        log('warn', `  El inventario no se pudo guardar (${lote.length} filas): ${error.message}`)
      }
      return false
    }
  }
  return true
}

/**
 * Marca como desaparecidas las causas que estaban en el inventario ANTERIOR y no aparecieron
 * en éste. Solo tiene sentido después de un barrido completo: por eso el llamador la usa
 * únicamente cuando el recorrido de años terminó sin cortes.
 *
 * NO borra la fila ni le cambia el estado a la causa: deja `desaparecida_desde` para que la
 * conciliación distinga "el portal ya no la muestra" de "nunca la vi". Una causa archivada
 * deja de aparecer en Mis Causas sin estar terminada, así que esto es un aviso, no una baja.
 */
export async function marcarDesaparecidas(
  corridaEn: string,
  ritsVistos: Set<string>,
): Promise<number> {
  const sb = initSupabase()
  try {
    const { data: anterior } = await sb
      .from('inventario_portal')
      .select('detectado_en')
      .lt('detectado_en', corridaEn)
      .order('detectado_en', { ascending: false })
      .limit(1)
    if (!anterior || anterior.length === 0) return 0

    const { data: filas, error } = await sb
      .from('inventario_portal')
      .select('id, rit')
      .eq('detectado_en', anterior[0].detectado_en)
      .is('desaparecida_desde', null)
      .limit(5000)
    if (error || !filas || filas.length === 0) return 0

    const ids = filas
      .filter((f: any) => !ritsVistos.has(String(f.rit).toUpperCase()))
      .map((f: any) => f.id as string)
    if (ids.length === 0) return 0

    let ok = 0
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await sb.from('inventario_portal')
        .update({ desaparecida_desde: corridaEn })
        .in('id', ids.slice(i, i + 100))
        .select('id')
      ok += (data || []).length
    }
    return ok
  } catch {
    return 0
  }
}

/**
 * RITs (sin letra) ya cargados en la base, para que el bot diga en consola cuántas causas
 * del portal todavía no están en ella. Null si la consulta falló.
 */
export async function getRitsSinLetraEnBd(): Promise<Set<string> | null> {
  const sb = initSupabase()
  try {
    const enBd = new Set<string>()
    for (let pagina = 0; pagina < 20; pagina++) {
      const { data, error } = await sb
        .from('causas')
        .select('rit')
        .not('rit', 'is', null)
        .range(pagina * 1000, pagina * 1000 + 999)
      if (error) { log('warn', `  No se pudo leer la base para conciliar: ${error.message}`); return null }
      for (const c of data || []) enBd.add(ritSinLetra(String(c.rit)))
      if ((data || []).length < 1000) break
    }
    return enBd
  } catch {
    return null
  }
}

/**
 * Obtiene las causas a scrapear, PRIORIZANDO las que aún NO tienen datos (movimientos),
 * para que cada tanda ataque causas nuevas y no re-scrapee las ya hechas.
 *
 * Orden de prioridad:
 *   1. Causas SIN movimientos y SIN la marca [NO EN PORTAL]  → lo que falta de verdad.
 *   2. (si sobra cupo) Causas CON movimientos, las menos actualizadas → refresco.
 * Nunca incluye las marcadas [NO EN PORTAL] (ruido que falla siempre), para no perder
 * ~1 min por tanda en cada una.
 *
 * Es DEFENSIVO: si cualquier consulta auxiliar falla, cae al comportamiento original
 * (ordenar por updated_at) para no romper el flujo que funciona.
 */
export async function getCausasToScrape(limit: number, priorizarUrgentes: boolean): Promise<CausaToScrape[]> {
  const sb = initSupabase()

  // Ruido sigue siendo ruido: las marcas legibles en notas ([REVISAR], [TERMINADA]…)
  // excluyen aunque el estado diga pendiente (una causa TERMINADA no se re-escanea).
  const esRuidoNotas = (notas: string | null) =>
    (notas || '').includes(MARCA_NO_EN_PORTAL)
    || (notas || '').includes(MARCA_REVISAR)
    || (notas || '').includes(MARCA_REVISAR_LETRA)
    || (notas || '').includes(MARCA_TERMINADA)

  // Fallback: consulta original (por si algo del camino optimizado falla).
  const fallback = async (): Promise<CausaToScrape[]> => {
    let q = sb.from('causas').select('id, rit').not('rit', 'is', null)
    if (priorizarUrgentes) q = q.order('updated_at', { ascending: true })
    const { data, error } = await q.limit(limit)
    if (error) { log('error', `Error obteniendo causas: ${error.message}`); return [] }
    return (data || []).map(c => ({ id: c.id, rit: c.rit }))
  }

  try {
    // 0) CAMINO NUEVO: cola oficial por escaneo_estado (requiere schema-001-cobertura.sql).
    //    'pendiente'/'error' primero, nunca escaneadas antes que escaneadas hace mucho.
    //    Si la columna no existe todavía (42703), seguimos con el camino legacy abajo.
    //
    // POR QUÉ SE PAGINA (arreglado 29-10-2026): el filtro de ruido va del lado del cliente,
    // así que un `.limit(limit)` a secas leía SOLO los primeros 33 de la cola. Esos 33 los
    // ocupaban causas descartadas ([NO EN PORTAL]/[REVISAR]/[TERMINADA], que ordenan primero
    // por no tener nunca_escaneada), la selección filtrada quedaba debajo del cupo y la tanda
    // caía al camino legacy — que re-escanea causas YA cargadas. Medido: 1198 en cola, 1151
    // descartables, 47 pendientes reales que NUNCA llegaban a procesarse; por_escanear clavado
    // en ~50 con corridas "33/33 exitosas". Se lee en bloques de 1000 hasta juntar `limit`
    // candidatos válidos (tope de 6 bloques = 6000 filas, holgado para la cola real).
    const seleccionCola: CausaToScrape[] = []
    let colaError: { code?: string; message?: string } | null = null
    for (let desde = 0, bloque = 0; seleccionCola.length < limit && bloque < 6; desde += 1000, bloque++) {
      const { data, error } = await sb
        .from('causas')
        .select('id, rit, notas')
        .in('escaneo_estado', ['pendiente', 'error'])
        .order('ultima_escaneada', { ascending: true, nullsFirst: true })
        .order('pendientes_desde', { ascending: true, nullsFirst: false })
        .range(desde, desde + 999)
      if (error) { colaError = error as any; break }
      const lote = data || []
      for (const c of lote) {
        if (esRuidoNotas((c as any).notas ?? null)) continue
        seleccionCola.push({ id: c.id, rit: c.rit })
        if (seleccionCola.length >= limit) break
      }
      if (lote.length < 1000) break
    }

    if (!colaError) {
      if (seleccionCola.length >= limit) {
        log('info', `  Cola oficial: ${seleccionCola.length} pendientes/error (las más antiguas primero).`)
        return seleccionCola.slice(0, limit)
      }
    } else if (colaError.code !== '42703') {
      log('warn', `  Consulta de cola falló (${colaError.message}); usando selección legacy.`)
    }

    // 1) (legacy/complemento) ids de causas que YA tienen movimientos, para refresco.
    //    Se paginan los movimientos y se arma un Set de causa_id.
    const conMovimientos = new Set<string>()
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb
        .from('movimientos')
        .select('causa_id')
        .range(desde, desde + 999)
      if (error) return await fallback()
      const lote = data || []
      for (const m of lote) if (m.causa_id) conMovimientos.add(m.causa_id as string)
      if (lote.length < 1000) break
    }

    // 2) Todas las causas candidatas (id, rit, notas), ordenadas por menos actualizadas.
    //    Traemos notas para poder excluir las marcadas [NO EN PORTAL].
    const causas: { id: string; rit: string; notas: string | null }[] = []
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb
        .from('causas')
        .select('id, rit, notas')
        .not('rit', 'is', null)
        .order('updated_at', { ascending: true })
        .range(desde, desde + 999)
      if (error) return await fallback()
      const lote = data || []
      for (const c of lote) causas.push({ id: c.id, rit: c.rit, notas: (c as any).notas ?? null })
      if (lote.length < 1000) break
    }

    // Fuera del loop: las confirmadas [NO EN PORTAL], las puestas en cuarentena [REVISAR]
    // (fallaron N veces seguidas por motivos transitorios) y las [REVISAR LETRA].
    //
    // Las [REVISAR LETRA] son causas cuyo RIT en la base NO coincide con el del portal: el
    // portal devuelve el mismo numero+anio con otra letra. Buscarlas tal cual NUNCA va a
    // funcionar, asi que si siguieran en la cola gastarian un cupo en cada corrida para
    // siempre. Necesitan una decision HUMANA (si el RIT del Excel esta mal o si es la causa
    // hermana), no mas reintentos. Caso real: X-2772-2023 y P-8656-2023, donde el portal
    // solo tiene P-2772-2023 y C-8656-2023; FIX_LETRAS ya creo y vinculo las hermanas, que
    // SI se scrapean, asi que el expediente real queda monitoreado igual.
    const ruido = causas.filter(c => esRuidoNotas(c.notas)).length

    // Prioridad 1: sin movimientos y sin marca de ruido.
    const sinDatos = causas.filter(c => !conMovimientos.has(c.id) && !esRuidoNotas(c.notas))
    // Prioridad 2: con movimientos (refresco), sin ruido.
    const conDatos = causas.filter(c => conMovimientos.has(c.id) && !esRuidoNotas(c.notas))

    // Completar el cupo que la cola oficial no llenó (o todo, si aún no hay cola).
    const enCola = new Set(seleccionCola.map(c => c.id))
    const legacy = [...sinDatos, ...conDatos].filter(c => !enCola.has(c.id))
    const seleccion = [...seleccionCola, ...legacy].slice(0, limit)
    log('info', `  Selección: ${seleccionCola.length} de la cola oficial + refresco. Cola: ${sinDatos.length} sin datos, ${conDatos.length} con datos, ${ruido} en cuarentena por notas. Se procesan ${seleccion.length}.`)
    return seleccion.map(c => ({ id: c.id, rit: c.rit }))
  } catch (e: any) {
    log('warn', `  Selección optimizada falló (${e?.message ?? e}); usando orden simple.`)
    return await fallback()
  }
}

/**
 * Marca una causa como "no encontrada en el portal" (ruido/otra competencia/archivada),
 * agregando [NO EN PORTAL] a `notas` para que getCausasToScrape NO la reintente en cada
 * tanda. Idempotente: no duplica la marca. También toca updated_at para bajarla en la cola.
 */
export async function marcarCausaNoEnPortal(causaId: string): Promise<void> {
  const sb = initSupabase()
  try {
    const { data } = await sb.from('causas').select('notas').eq('id', causaId).limit(1)
    const notas: string = (data && data[0]?.notas) || ''
    // Equivalente oficial en la cola: sale de pendientes como 'descatalogada' (el trigger
    // limpia pendientes_desde). Se hace TAMBIÉN si la nota ya estaba: una causa heredada del
    // Excel puede tener [NO EN PORTAL] en notas y el estado 'pendiente' puesto por el
    // backfill, y sin esto quedaría cuenta de más en "pendientes" para siempre.
    await setEscaneoEstado(causaId, 'descatalogada')
    if (notas.includes(MARCA_NO_EN_PORTAL)) {
      // Ya marcada: solo actualizar updated_at para mantenerla al fondo de la cola.
      await sb.from('causas').update({ updated_at: new Date().toISOString() }).eq('id', causaId)
      return
    }
    const nuevas = notas ? `${notas}\n${MARCA_NO_EN_PORTAL} no aparece en el portal de Familia (posible ruido/otra competencia/archivada).` : `${MARCA_NO_EN_PORTAL} no aparece en el portal de Familia (posible ruido/otra competencia/archivada).`
    await sb.from('causas').update({ notas: nuevas, updated_at: new Date().toISOString() }).eq('id', causaId)
  } catch (e: any) {
    log('warn', `  No se pudo marcar [NO EN PORTAL] la causa ${causaId}: ${e?.message ?? e}`)
  }
}

/** Prefijo del contador de intentos fallidos consecutivos, guardado en `notas`. */
const MARCA_INTENTOS = '[INTENTOS FALLIDOS:'
/** Regex para leer/quitar la línea del contador. */
const RE_INTENTOS = /\[INTENTOS FALLIDOS:\s*(\d+)\]/i

/**
 * BLINDAJE anti-loop para tandas desatendidas.
 *
 * Cuando una causa NO se encuentra por un fallo TRANSITORIO (timeout, panel no cargó,
 * resultado vacío sin el mensaje canónico del portal), NO la sacamos de la cola al primer
 * intento (podría ser una causa real que falló por flakiness). Pero si falla `maxIntentos`
 * VECES SEGUIDAS, la ponemos en CUARENTENA [REVISAR] para que deje de consumir cupo tanda
 * tras tanda. Una causa real que se encuentra bien limpia su contador (borrarContadorIntentos).
 *
 * IMPORTANTE: usamos [REVISAR], NO [NO EN PORTAL]. Un fallo transitorio repetido NO prueba
 * que la causa no exista; puede ser flakiness sostenida del portal. [REVISAR] la saca del
 * loop pero queda visible para revisión manual (no se pierde silenciosamente).
 *
 * Devuelve true si en esta llamada se alcanzó el tope y se puso [REVISAR].
 */
export async function registrarIntentoFallido(causaId: string, maxIntentos = 3): Promise<boolean> {
  const sb = initSupabase()
  try {
    const { data } = await sb.from('causas').select('notas').eq('id', causaId).limit(1)
    const notas: string = (data && data[0]?.notas) || ''
    // Si ya está fuera del loop (marcada [NO EN PORTAL] o ya en [REVISAR]), no hay nada que
    // contar. Se reaprovecha el paso para PONER EL ESTADO que le corresponde: una causa
    // heredada puede traer la marca en notas y seguir en 'pendiente' (el backfill no puede
    // saberlo), y sin esto el panel contaría como pendiente algo que el bot ya descartó.
    if (notas.includes(MARCA_NO_EN_PORTAL)) {
      await setEscaneoEstado(causaId, 'descatalogada')
      return false
    }
    if (notas.includes(MARCA_REVISAR)) {
      await setEscaneoEstado(causaId, 'error')
      return false
    }

    const m = notas.match(RE_INTENTOS)
    const previos = m ? parseInt(m[1], 10) || 0 : 0
    const actual = previos + 1

    // Quitar la línea vieja del contador (si existía) para reescribirla.
    const sinContador = notas
      .split('\n')
      .filter(l => !l.includes(MARCA_INTENTOS))
      .join('\n')
      .trim()

    if (actual >= maxIntentos) {
      // Se alcanzó el tope: poner en CUARENTENA [REVISAR] (no [NO EN PORTAL]) y limpiar el contador.
      const nuevas = sinContador
        ? `${sinContador}\n${MARCA_REVISAR} el bot no la encontró tras ${actual} intentos (revisar manualmente: puede ser ruido/archivada o flakiness del portal).`
        : `${MARCA_REVISAR} el bot no la encontró tras ${actual} intentos (revisar manualmente: puede ser ruido/archivada o flakiness del portal).`
      await sb.from('causas').update({ notas: nuevas, updated_at: new Date().toISOString() }).eq('id', causaId)
      // Cuarentena también en la cola oficial: 'error' queda visible en el panel como
      // "N causas con error" en vez de desaparecer detrás de una nota.
      await setEscaneoEstado(causaId, 'error')
      return true
    }

    // Aún no llega al tope: solo actualizar el contador.
    const linea = `${MARCA_INTENTOS} ${actual}]`
    const nuevas = sinContador ? `${sinContador}\n${linea}` : linea
    await sb.from('causas').update({ notas: nuevas, updated_at: new Date().toISOString() }).eq('id', causaId)
    return false
  } catch (e: any) {
    log('warn', `  No se pudo registrar intento fallido de ${causaId}: ${e?.message ?? e}`)
    return false
  }
}

/**
 * Limpia el contador de intentos fallidos de una causa (cuando SÍ se encontró/scrapeó bien).
 * Así un fallo transitorio no arrastra el contador para siempre: borrón y cuenta nueva.
 * Conserva el resto de las notas. No-op si no había contador.
 */
export async function borrarContadorIntentos(causaId: string): Promise<void> {
  const sb = initSupabase()
  try {
    const { data } = await sb.from('causas').select('notas').eq('id', causaId).limit(1)
    const notas: string = (data && data[0]?.notas) || ''
    if (!notas.includes(MARCA_INTENTOS)) return // nada que limpiar
    const limpio = notas
      .split('\n')
      .filter(l => !l.includes(MARCA_INTENTOS))
      .join('\n')
      .trim()
    await sb.from('causas').update({ notas: limpio || null }).eq('id', causaId)
  } catch {
    // silencioso: limpiar el contador es best-effort, no debe frenar el scraping.
  }
}

/**
 * RECUPERACIÓN: quita la marca [NO EN PORTAL] de TODAS las causas, para que vuelvan a
 * entrar a la cola de scraping. Se usa vía BOT_LIMPIAR_NO_EN_PORTAL=1 por si alguna causa
 * quedó marcada de más (aunque hoy solo se marca ante confirmación explícita del portal).
 * Devuelve cuántas causas se limpiaron. Quita SOLO la línea de la marca, conserva el resto
 * de las notas ([VÍNCULO], [REVISAR LETRA], etc.).
 */
export async function limpiarMarcasNoEnPortal(): Promise<number> {
  const sb = initSupabase()
  let limpiadas = 0
  try {
    // Traer las que tienen la marca (paginado).
    const marcadas: { id: string; notas: string | null }[] = []
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb
        .from('causas')
        .select('id, notas')
        .ilike('notas', `%${MARCA_NO_EN_PORTAL}%`)
        .range(desde, desde + 999)
      if (error) { log('warn', `  No se pudieron leer causas marcadas: ${error.message}`); return limpiadas }
      const lote = data || []
      for (const c of lote) marcadas.push({ id: c.id, notas: (c as any).notas ?? null })
      if (lote.length < 1000) break
    }
    for (const c of marcadas) {
      // Quitar las líneas que contienen la marca, conservar el resto.
      const limpio = (c.notas || '')
        .split('\n')
        .filter(l => !l.includes(MARCA_NO_EN_PORTAL))
        .join('\n')
        .trim()
      await sb.from('causas').update({ notas: limpio || null, updated_at: new Date().toISOString() }).eq('id', c.id)
      // Y reengancharla a la cola oficial: si no hacemos esto, la causa queda marcada
      // como 'descatalogada' para siempre y el limpiar Marcas NO la devuelve a pendientes.
      await setEscaneoEstado(c.id, 'pendiente')
      limpiadas++
    }
  } catch (e: any) {
    log('warn', `  Error limpiando marcas [NO EN PORTAL]: ${e?.message ?? e}`)
  }
  return limpiadas
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
 * Sincroniza movimientos (evita duplicados).
 *
 * DOS CAMINOS, deliberadamente:
 *   A) Con schema-001-cobertura.sql aplicado: `upsert ... onConflict('causa_id,uniq_clave')`
 *      con ignoreDuplicates. Una sola escritura, sin SELECT previo por causa, y la base
 *      garantiza la unicidad (antes la dedupe dependía de que el `fecha|tramite` del bot
 *      coincidiera byte a byte con el de la fila leída, y dos corridas podían duplicar si
 *      el texto cambiaba de espacios).
 *   B) Sin migración (o si el upsert falla por constraint/columna inexistente): el camino
 *      viejo — leer existentes, filtrar, insertar.
 *
 * El código de error distingue: 42P10 = no hay constraint único; 42703 = columna
 * uniq_clave inexistente. Ambos significan "migración no corrida" → caer al viejo.
 */
async function syncMovimientos(sb: SupabaseClient, data: CausaScrapedData): Promise<void> {
  const mapear = (nuevos: typeof data.movimientos) => nuevos.map(m => ({
    causa_id: data.causa_id,
    fecha: m.fecha,
    etapa: m.etapa || null,
    tramite: m.tramite,
    descripcion: m.descripcion || null,
    es_traslado_curador: m.es_traslado_curador,
    fuente: 'pjud_bot',
  }))

  // ---- Camino A: upsert con constraint único (una escritura, sin SELECT por causa). ----
  try {
    let insertados = 0
    let fallo = false
    for (let i = 0; i < data.movimientos.length; i += 100) {
      const batch = mapear(data.movimientos.slice(i, i + 100))
      const { data: creados, error } = await sb
        .from('movimientos')
        .upsert(batch, { onConflict: 'causa_id,uniq_clave', ignoreDuplicates: true })
        .select('id')
      if (error) {
        const code = (error as any)?.code
        if (code === '42P10' || code === '42703') break  // migración pendiente → camino B
        fallo = true
        log('warn', `Error insertando movimientos de ${data.rit}: ${error.message}`)
        break
      }
      insertados += (creados || []).length
    }
    if (!fallo) {
      if (insertados > 0) log('info', `  +${insertados} movimientos nuevos para ${data.rit}`)
      return
    }
  } catch {
    // se cae al camino viejo abajo
  }

  // ---- Camino B (legacy): leer, filtrar en memoria, insertar. ----
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
  const records = mapear(nuevos)

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
 * Sincroniza audiencias (inserta nuevas, no duplica).
 * Igual que syncMovimientos: upsert con onConflict si la migración está aplicada, y
 * si no, el filtro en memoria de siempre.
 */
async function syncAudiencias(sb: SupabaseClient, data: CausaScrapedData): Promise<void> {
  const registros = data.audiencias.map(a => ({
    causa_id: data.causa_id,
    fecha: a.fecha,
    tipo: a.tipo,
    notas: a.estado ? `Estado: ${a.estado}${a.sala ? ` | Sala: ${a.sala}` : ''}` : null,
  }))

  try {
    const { data: creadas, error } = await sb
      .from('audiencias')
      .upsert(registros, { onConflict: 'causa_id,uniq_clave', ignoreDuplicates: true })
      .select('id')
    const code = (error as any)?.code
    if (!error) {
      const n = (creadas || []).length
      if (n > 0) log('info', `  +${n} audiencias nuevas para ${data.rit}`)
      return
    }
    if (code !== '42P10' && code !== '42703') {
      log('warn', `Error insertando audiencias de ${data.rit}: ${error.message}`)
      return
    }
    // migración no corrida → sigue con el camino legacy
  } catch {
    // se cae al camino viejo abajo
  }

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
    const { error } = await sb.from('audiencias').insert(nuevas.map(a => ({
      causa_id: data.causa_id,
      fecha: a.fecha,
      tipo: a.tipo,
      notas: a.estado ? `Estado: ${a.estado}${a.sala ? ` | Sala: ${a.sala}` : ''}` : null,
    })))
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
 * Guarda el estado FINAL de una ejecución del bot, incluyendo las métricas de
 * auto-aprendizaje (duración, velocidad, tasa de éxito).
 *
 * ES UN UPSERT sobre run_id, no un insert. Desde que el orquestador va publicando
 * progreso en vivo (upsertBotRunProgreso), la fila de la corrida YA existe cuando
 * llegamos acá; con `insert` el cierre fallaba por unique y se PERDÍA el registro
 * completo de la sesión.
 *
 * Robustez: si las columnas nuevas todavía no existen en la BD (no se corrió
 * db/migraciones/schema-bot-aprendizaje.sql), reintenta solo con las columnas base para no perder
 * el registro de la sesión.
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

  // Si run_id NO tiene constraint/índice único (migración de cobertura no corrida),
  // el upsert devuelve 42P10. En ese caso NO tiramos la corrida: caemos al insert
  // simple de siempre, que en esa base vieja es la única forma de registrarla.
  const escribe = async (payload: Record<string, any>) => {
    const up = await sb.from('bot_runs').upsert(payload, { onConflict: 'run_id' })
    if (!up.error) return null
    if ((up.error as any)?.code === '42P10') {
      const ins = await sb.from('bot_runs').insert(payload)
      return ins.error
    }
    return up.error
  }

  const error = await escribe(conMetricas)
  if (!error) return

  // Solo degradamos a "columnas base" si el error es COLUMNA INEXISTENTE (Postgres 42703),
  // es decir, todavía no se corrió db/migraciones/schema-bot-aprendizaje.sql. Cualquier otro error
  // (constraint, red, etc.) se reporta con su mensaje real — no lo ocultamos.
  const esColumnaFaltante = (error as any)?.code === '42703'
  if (!esColumnaFaltante) {
    log('warn', `No se pudo guardar estado del bot: ${error.message}`)
    return
  }

  const baseErr = await escribe(base)
  if (baseErr) {
    log('warn', `No se pudo guardar estado del bot (columnas base): ${baseErr.message}`)
  } else {
    log('warn', 'bot_runs guardado sin métricas nuevas (corré db/migraciones/schema-bot-aprendizaje.sql para habilitarlas)')
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
 * Marca una causa como "última vez scrapeada" y oficializa su estado de cola.
 *   movimientosEncontrados > 0 → 'ok'; == 0 → 'sin_datos' (el portal la tiene PERO sin
 *   movimientos: NO es "falta escanear", y esa distinción es la que faltaba para que
 *   el contador de pendientes fuera honesto).
 */
export async function markCausaScraped(causaId: string, movimientosEncontrados = 0, runId?: string): Promise<void> {
  const sb = initSupabase()
  
  await sb
    .from('causas')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', causaId)

  await setEscaneoEstado(
    causaId,
    movimientosEncontrados > 0 ? 'ok' : 'sin_datos',
    { contarScan: true, runId },
  )
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

    // Mantener rol/anio consistentes con el nuevo rit (la identidad estable no debería
    // cambiar al corregir la letra, pero re-derivarla garantiza que nunca queden desfasados).
    const { rol, anio } = rolAnioDeRit(nuevoRit)
    const { error } = await sb
      .from('causas')
      .update({ rit: nuevoRit, rol, anio, tipo: nuevoTipo, updated_at: new Date().toISOString() })
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


/**
 * Inserta una causa "hermana" descubierta en el portal (ej. la X-4596-2024 que nace
 * cuando la P-4596-2024 llega a cumplimiento). SOLO inserta si el RIT no existe aún;
 * si ya existe devuelve su id (no duplica). Devuelve { id, creada } donde `creada`
 * indica si se insertó ahora. NUNCA pisa una causa existente.
 * `tipo` debe venir ya validado (inferirTipoRIT) por el llamador.
 */
export async function upsertCausaHermana(
  rit: string,
  tipo: string | null,
  caratulado: string | null,
): Promise<{ id: string | null; creada: boolean }> {
  const sb = initSupabase()
  // Defensa propia: solo escribir un tipo que respete el CHECK causas_tipo_check.
  // Si el tipo recibido no está en la lista blanca, se guarda null (válido) en vez de
  // hacer fallar el insert en silencio. No dependemos de que el llamador ya lo validara.
  const tipoSeguro = tipo && (TIPOS_RIT_VALIDOS as readonly string[]).includes(tipo) ? tipo : null
  try {
    const { data: existente } = await sb.from('causas').select('id').eq('rit', rit).limit(1)
    if (existente && existente.length > 0) {
      return { id: existente[0].id, creada: false }
    }
    const { rol, anio } = rolAnioDeRit(rit)
    // origen: 'portal' = la creó el bot al descubrir la hermana (no el Excel ni el pegado).
    // Si la columna no existe todavía (migración pendiente) el insert con `origen` falla con
    // 42703; se reintenta SIN esa columna para no perder la creación de la hermana.
    const base = { rit, rol, anio, tipo: tipoSeguro, caratulado: caratulado || null }
    let { data, error } = await sb
      .from('causas')
      .insert({ ...base, origen: 'portal' })
      .select('id')
      .limit(1)
    if (error && (error as any).code === '42703') {
      ({ data, error } = await sb.from('causas').insert(base).select('id').limit(1))
    }
    if (error) {
      log('warn', `  No se pudo crear la causa hermana ${rit}: ${error.message}`)
      return { id: null, creada: false }
    }
    return { id: (data && data[0]?.id) || null, creada: true }
  } catch (e: any) {
    log('warn', `  Excepción creando causa hermana ${rit}: ${e?.message ?? e}`)
    return { id: null, creada: false }
  }
}

/**
 * Deja una señal de VÍNCULO en el campo `notas` de una causa, para indicar que está
 * relacionada con otra(s) (ej. una protección P con su cumplimiento X). Idempotente:
 * no duplica la marca de vínculo con el mismo RIT relacionado.
 */
export async function vincularCausaEnNotas(id: string, ritRelacionado: string, detalle: string): Promise<void> {
  const sb = initSupabase()
  try {
    const { data } = await sb.from('causas').select('notas').eq('id', id).limit(1)
    const notasActuales: string = (data && data[0]?.notas) || ''
    // Evitar duplicar el vínculo hacia el MISMO rit relacionado. Comparamos el rit como
    // TOKEN delimitado (bordes de palabra), NO como substring: así "4596" en "X-4596-2024"
    // no da falso positivo contra "P-45960-2024" y no se salta un vínculo legítimo.
    const yaVinculado = notasActuales.includes('[VÍNCULO]') &&
      new RegExp(`(^|[^\\w-])${ritRelacionado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(notasActuales)
    if (yaVinculado) return
    const marca = `[VÍNCULO] ${detalle}`
    const nuevas = notasActuales ? `${notasActuales}\n${marca}` : marca
    await sb.from('causas').update({ notas: nuevas, updated_at: new Date().toISOString() }).eq('id', id)
  } catch (e: any) {
    log('warn', `  No se pudo vincular la causa ${id}: ${e?.message ?? e}`)
  }
}
