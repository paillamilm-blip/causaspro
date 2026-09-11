// ============================================================
// CAUSASPRO BOT - Scraper Module
// Extrae datos de una causa: movimientos, audiencias, resoluciones
// ============================================================

import type { Page } from 'playwright'
import type { MovimientoPJUD, AudienciaPJUD, ResolucionPJUD, CausaScrapedData, CausaToScrape } from '../types'
import { parsePJUDDate, cleanText, detectTrasladoCurador, log } from '../utils'

/**
 * Extrae todos los datos de una causa (ya estando en la página de detalle)
 */
export async function scrapeCausaCompleta(page: Page, causa: CausaToScrape): Promise<CausaScrapedData> {
  const result: CausaScrapedData = {
    rit: causa.rit,
    causa_id: causa.id,
    movimientos: [],
    audiencias: [],
    resoluciones: [],
    tiene_traslado_curador: false,
    fecha_scraping: new Date().toISOString(),
  }
  
  try {
    // 1. Extraer estado actual
    result.estado_actual = await extractEstadoActual(page)
    
    // 2. Extraer movimientos/historial de tramitación (pestaña "Movimientos")
    result.movimientos = await extractMovimientos(page)

    // 3. DERIVAR audiencias y resoluciones DESDE los movimientos.
    //    IMPORTANTE (confirmado con el portal real): el detalle de causa de Familia NO tiene
    //    pestañas separadas de "Audiencias" ni "Resoluciones". Las audiencias y resoluciones
    //    aparecen como FILAS dentro de "Movimientos", identificadas por la columna Trámite
    //    (ej. Trámite="Audiencia", "Audiencia Preparatoria"; Trámite="Resolución").
    //    Antes buscábamos pestañas inexistentes → siempre daba 0. Ahora las clasificamos
    //    a partir de los movimientos ya scrapeados (sin tocar el portal de nuevo).
    result.audiencias = derivarAudiencias(result.movimientos)
    result.resoluciones = derivarResoluciones(result.movimientos)

    // 5. Detectar TRASLADO AL CURADOR
    result.tiene_traslado_curador = result.movimientos.some(m => m.es_traslado_curador)
    
    log('success', `${causa.rit}: ${result.movimientos.length} mov, ${result.audiencias.length} aud, ${result.resoluciones.length} res ${result.tiene_traslado_curador ? '🔴 TRASLADO CURADOR' : ''}`)
    
  } catch (error: any) {
    result.error = error.message
    log('error', `Error scraping ${causa.rit}: ${error.message}`)
  }
  
  return result
}

// ============================================================
// EXTRACTORES ESPECÍFICOS
// ============================================================

/**
 * Extrae el estado actual de la causa
 */
async function extractEstadoActual(page: Page): Promise<string | undefined> {
  try {
    // Buscar el estado en varios posibles selectores
    const selectors = [
      '.estado-causa',
      'span:has-text("Estado")',
      'td:has-text("Estado") + td',
      '.info-causa .estado',
      'label:has-text("Estado") ~ span',
      'dt:has-text("Estado") + dd',
    ]
    
    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (el) {
          const text = await el.textContent()
          if (text && text.trim() && text.trim() !== 'Estado') {
            return cleanText(text)
          }
        }
      } catch {}
    }
    
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Extrae la tabla de movimientos/historial de tramitación
 */
async function extractMovimientos(page: Page): Promise<MovimientoPJUD[]> {
  const movimientos: MovimientoPJUD[] = []

  try {
    // ESTRUCTURA REAL confirmada con diagnóstico (causa de Familia P-7336-2026):
    // La tabla de Movimientos NO tiene id ni pestaña separada; es una <table> cuyos
    // ENCABEZADOS son: Folio | Doc. | Anexos | Etapa | Estado | Trámite | Desc. Trámite |
    // Fecha Trámite | Georeferencia. La fecha NO es la primera columna (es la 8ª), por eso
    // el parser viejo (que asumía Fecha|Etapa|Trámite|Desc y buscaba la 1ª fecha) fallaba.
    //
    // Estrategia robusta: recorrer TODAS las tablas en el navegador, ubicar la que tenga
    // encabezados de movimientos (Trámite + Fecha Trámite), y MAPEAR CADA COLUMNA POR SU
    // ENCABEZADO (no por posición). Así da igual el orden/número de columnas.
    const filas = await page.evaluate(() => {
      const __name = (x: any) => x  // ver nota sobre esbuild/keepNames arriba
      const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim()
      const lower = (s: string) => norm(s).toLowerCase()

      const tables = Array.from(document.querySelectorAll('table')) as HTMLTableElement[]
      // Elegir la tabla de movimientos por sus encabezados: debe tener "trámite" y una
      // columna de fecha ("fecha trámite" / "fecha"). Excluir la de notificaciones (que
      // tiene "tipo notif"/"ente notif") y otras.
      let target: HTMLTableElement | null = null
      let headers: string[] = []
      for (const t of tables) {
        const ths = Array.from(t.querySelectorAll('th')).map(th => lower(th.textContent || ''))
        if (ths.length === 0) continue
        const tieneTramite = ths.some(h => h.includes('trámite') || h.includes('tramite'))
        const tieneFecha = ths.some(h => h.includes('fecha'))
        const esNotif = ths.some(h => h.includes('notif')) // tabla de Notificaciones
        const esPlazo = ths.some(h => h.includes('ámbito') || h.includes('ambito') || h.includes('duración') || h.includes('duracion'))
        if (tieneTramite && tieneFecha && !esNotif && !esPlazo) {
          target = t
          headers = ths
          break
        }
      }
      if (!target) return { headers: [] as string[], rows: [] as string[][] }

      // Índice de cada columna por su encabezado (tolerante a acentos/variantes).
      const idxDe = (...claves: string[]) =>
        headers.findIndex(h => claves.some(k => h.includes(k)))
      const iEtapa = idxDe('etapa')
      const iEstado = idxDe('estado')
      // "trámite" a secas (columna del tipo: Actuación/Resolución/Audiencia). Evitar que
      // matchee "desc. trámite" o "fecha trámite": buscamos el header que sea exactamente
      // "trámite"/"tramite".
      let iTramite = headers.findIndex(h => h === 'trámite' || h === 'tramite')
      if (iTramite === -1) iTramite = idxDe('trámite', 'tramite')
      const iDesc = idxDe('desc') // "Desc. Trámite"
      // Fecha: preferir "fecha trámite"; si no, la primera columna con "fecha" (por si otra
      // vista trae "Fecha Ingreso" antes, no queremos enganchar la equivocada).
      let iFecha = headers.findIndex(h => h.includes('fecha') && (h.includes('trámite') || h.includes('tramite')))
      if (iFecha === -1) iFecha = idxDe('fecha')

      const out: string[][] = []
      const trs = Array.from(target.querySelectorAll('tbody tr, tr'))
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll('td'))
        if (tds.length === 0) continue
        const celdas = tds.map(td => norm(td.textContent || ''))
        // Fila válida solo si tiene contenido real (evita filas de paginación/total).
        const textoFila = celdas.join(' ')
        if (/total de registros|inicio|anterior/i.test(textoFila) && celdas.length < 4) continue
        // Empaquetar como [etapa, estado, tramite, desc, fecha] usando los índices reales.
        const val = (i: number) => (i >= 0 && i < celdas.length ? celdas[i] : '')
        out.push([val(iEtapa), val(iEstado), val(iTramite), val(iDesc), val(iFecha), textoFila])
      }
      // Reportamos iTramite para avisar (afuera) si NO se pudo mapear la columna clave:
      // sin "Trámite", la clasificación de audiencias/resoluciones quedaría vacía.
      return { headers, rows: out, tieneColumnaTramite: iTramite >= 0 }
    })

    if (filas.rows.length === 0) {
      log('warn', 'No se encontró tabla de movimientos (por encabezados Trámite + Fecha)')
      return movimientos
    }
    if (!filas.tieneColumnaTramite) {
      // No es fatal (igual guardamos movimientos), pero avisamos: sin columna "Trámite"
      // la derivación de audiencias/resoluciones no podrá clasificar por tipo.
      log('warn', 'Tabla de movimientos SIN columna "Trámite" reconocible → audiencias/resoluciones podrían quedar vacías. Revisar encabezados con BOT_DIAG_DETALLE=1.')
    }

    // Convertir cada fila [etapa, estado, tramite, desc, fecha, textoCompleto] a MovimientoPJUD.
    for (const r of filas.rows) {
      const [etapa, estado, tramite, desc, fechaRaw, textoFila] = r
      const fecha = parsePJUDDate(fechaRaw) || extraerFechaDeTexto(fechaRaw) || extraerFechaDeTexto(textoFila)
      // Sin fecha reconocible → probablemente no es una fila de movimiento real.
      if (!fecha) continue
      const tramiteFinal = cleanText(tramite) || cleanText(desc) || 'Movimiento'
      // Descripción combinada: Desc. Trámite (+ Estado como contexto si aporta).
      const descripcion = cleanText(desc) || undefined
      movimientos.push({
        fecha,
        etapa: cleanText(etapa) || undefined,
        tramite: tramiteFinal,
        descripcion,
        // Detección de urgencia sobre TODA la fila (no solo trámite/desc), así el patrón
        // nunca se pierde por estar en otra columna (Estado, Etapa, etc.).
        es_traslado_curador: detectTrasladoCurador(textoFila),
      })
    }

  } catch (error: any) {
    log('warn', `Error extrayendo movimientos: ${error.message}`)
  }

  return movimientos
}

/**
 * Busca una fecha (dd/mm/aaaa o dd-mm-aaaa) DENTRO de un texto libre y la normaliza.
 * Devuelve la fecha ISO (vía parsePJUDDate) o null si no hay una fecha reconocible.
 * Se usa para intentar rescatar la fecha REAL de una audiencia desde la descripción
 * del trámite (ej. "Cita a Aud. Preparatoria ZOOM para el 12-03-2026").
 */
function extraerFechaDeTexto(texto: string | undefined): string | null {
  if (!texto) return null
  const m = texto.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/)
  if (!m) return null
  return parsePJUDDate(m[1])
}

/**
 * DERIVA las audiencias a partir de los movimientos ya extraídos.
 *
 * En el portal de Familia las audiencias son filas de "Movimientos" cuyo Trámite indica
 * una audiencia. Ejemplos reales vistos: Trámite="Audiencia" con Desc.="Audiencia
 * Preparatoria"; Etapa="Aud. Prep.". Reconocemos por palabra clave "audiencia" en
 * trámite/descripción/etapa. El "tipo" de audiencia es la descripción (más informativa)
 * o el trámite; el "estado" lo tomamos de la etapa si aporta.
 */
function derivarAudiencias(movimientos: MovimientoPJUD[]): AudienciaPJUD[] {
  const audiencias: AudienciaPJUD[] = []
  for (const m of movimientos) {
    const tramite = (m.tramite || '').toLowerCase()
    const campos = `${m.tramite || ''} ${m.descripcion || ''} ${m.etapa || ''}`.toLowerCase()
    if (!campos.includes('audiencia')) continue

    // Evitar FALSOS POSITIVOS: filas que solo *mencionan* una audiencia (notificación,
    // certificación, acta, citación) no son la audiencia en sí. Solo contamos como
    // audiencia cuando el TRÁMITE es propiamente "audiencia" (ej. Trámite="Audiencia").
    const esRuido = /notific|certif|acta|c[ií]ta/.test(tramite)
    if (!tramite.includes('audiencia') && esRuido) continue

    // FECHA: la fecha del movimiento es la fecha de REGISTRO del trámite, NO necesariamente
    // la fecha en que ocurre/ocurrió la audiencia. Intentamos extraer una fecha explícita
    // del texto de la descripción (ej. "... 12-03-2026"); si no hay, usamos la del movimiento
    // pero marcamos la audiencia como histórica para no confundir al detector de "próximas".
    const fechaEnTexto = extraerFechaDeTexto(m.descripcion) || extraerFechaDeTexto(m.tramite)
    audiencias.push({
      fecha: fechaEnTexto || m.fecha,
      tipo: (m.descripcion && m.descripcion.length > 0 ? m.descripcion : m.tramite) || 'Audiencia',
      // NO usamos m.etapa como "estado": la etapa procesal ("Aud. Prep.") no indica el estado
      // real de la audiencia (Programada/Realizada/Suspendida). Sin dato fiable → sin estado,
      // salvo que el texto lo diga explícitamente.
      estado: /suspend|cancel/i.test(campos) ? 'Suspendida'
            : (fechaEnTexto ? undefined : 'histórica (fecha de registro)'),
    })
  }
  return audiencias
}

/**
 * DERIVA las resoluciones a partir de los movimientos ya extraídos.
 *
 * En el portal de Familia las resoluciones son filas de "Movimientos" cuyo Trámite es
 * "Resolución" (ej. Desc.="Cita a Aud. Preparatoria ZOOM"). Reconocemos por "resoluc"
 * (cubre "Resolución"/"Resolucion") o "sentencia" en el trámite.
 */
function derivarResoluciones(movimientos: MovimientoPJUD[]): ResolucionPJUD[] {
  const resoluciones: ResolucionPJUD[] = []
  for (const m of movimientos) {
    const tramite = (m.tramite || '').toLowerCase()
    if (!tramite.includes('resoluc') && !tramite.includes('sentencia')) continue
    resoluciones.push({
      fecha: m.fecha,
      tipo: m.tramite || 'Resolución',
      texto_resumen: m.descripcion,
    })
  }
  return resoluciones
}

// ============================================================
// PARSERS DE FILAS
// ============================================================
// (parseMovimientoRow eliminado: la extracción de movimientos ahora mapea columnas POR
//  ENCABEZADO dentro de extractMovimientos —ver arriba—, en vez de adivinar por posición.
//  parseAudienciaRow / parseResolucionRow también se eliminaron: audiencias y resoluciones
//  se DERIVAN de los movimientos, ver derivarAudiencias/derivarResoluciones.
//  clickTab / findTable / loadAllPages se eliminaron: buscaban tabs/tablas por selectores
//  adivinados que no existen en el detalle de Familia; extractMovimientos ya localiza la
//  tabla por sus encabezados reales en un único page.evaluate.)
