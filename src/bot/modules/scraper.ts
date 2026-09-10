// ============================================================
// CAUSASPRO BOT - Scraper Module
// Extrae datos de una causa: movimientos, audiencias, resoluciones
// ============================================================

import type { Page } from 'playwright'
import type { MovimientoPJUD, AudienciaPJUD, ResolucionPJUD, CausaScrapedData, CausaToScrape } from '../types'
import { OJV_SELECTORS, DEFAULT_CONFIG } from '../config'
import { parsePJUDDate, cleanText, detectTrasladoCurador, sleep, log } from '../utils'

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
    // Navegar al tab de historial/tramitación si existe
    const tabClicked = await clickTab(page, [
      'a:has-text("Historial")',
      'a:has-text("Tramitación")',
      'a:has-text("Movimientos")',
      'li:has-text("Historial") a',
      'li:has-text("Tramitación") a',
      '#tabHistorial',
      'a[href*="historial"]',
      'a[href*="tramitacion"]',
    ])
    
    if (tabClicked) {
      await sleep(2000 + Math.random() * 1500)
    }
    
    // Buscar la tabla de movimientos
    const table = await findTable(page, [
      'table:has(th:has-text("Trámite"))',
      'table:has(th:has-text("Tramite"))',
      'table:has(th:has-text("Actuación"))',
      '#tablaMovimientos',
      '.tabla-historial table',
      'table.movimientos',
      'table:has(th:has-text("Fecha"))',
    ])
    
    if (!table) {
      log('warn', 'No se encontró tabla de movimientos')
      return movimientos
    }
    
    // Extraer filas
    const rows = await table.$$('tbody tr')
    
    for (const row of rows) {
      try {
        const cells = await row.$$('td')
        if (cells.length < 2) continue
        
        // La estructura típica es: Fecha | Etapa | Trámite | Descripción
        // Pero puede variar
        const textos = await Promise.all(cells.map(async (cell: any) => {
          const text = await cell.textContent()
          return cleanText(text)
        }))
        
        // Identificar columnas por contenido
        const movimiento = parseMovimientoRow(textos)
        if (movimiento) {
          movimientos.push(movimiento)
        }
      } catch {}
    }
    
    // Si hay paginación, intentar cargar más
    await loadAllPages(page)
    
    // Extraer filas adicionales si se cargaron más
    const additionalRows = await table.$$('tbody tr')
    if (additionalRows.length > rows.length) {
      for (let i = rows.length; i < additionalRows.length; i++) {
        try {
          const cells = await additionalRows[i].$$('td')
          if (cells.length < 2) continue
          const textos = await Promise.all(cells.map(async (cell: any) => {
            const text = await cell.textContent()
            return cleanText(text)
          }))
          const movimiento = parseMovimientoRow(textos)
          if (movimiento) movimientos.push(movimiento)
        } catch {}
      }
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

function parseMovimientoRow(textos: string[]): MovimientoPJUD | null {
  if (textos.length < 2) return null

  // Normalizar celdas (sin vacíos) para razonar sobre las columnas reales
  const celdas = textos.map(t => (t || '').trim())

  // 1. Ubicar la celda que contiene la fecha (puede no ser la primera columna)
  let fechaIdx = -1
  let fecha: string | null = null
  for (let i = 0; i < celdas.length; i++) {
    const parsed = parsePJUDDate(celdas[i])
    if (parsed) {
      fecha = parsed
      fechaIdx = i
      break
    }
  }

  if (!fecha) return null

  // 2. Las celdas posteriores a la fecha son el contenido del movimiento.
  //    Estructura típica del OJV: Fecha | Etapa | Trámite | Descripción,
  //    pero el número y orden de columnas puede variar entre tribunales.
  const contenido = celdas.slice(fechaIdx + 1).filter(c => c.length > 0)

  if (contenido.length === 0) return null

  // 3. Asignar campos de forma predecible:
  //    - 1 celda  → es el trámite
  //    - 2 celdas → etapa + trámite
  //    - 3+ celdas → etapa + trámite + descripción (resto concatenado)
  let etapa: string | undefined
  let tramite: string
  let descripcion: string | undefined

  if (contenido.length === 1) {
    tramite = contenido[0]
  } else if (contenido.length === 2) {
    etapa = contenido[0]
    tramite = contenido[1]
  } else {
    etapa = contenido[0]
    tramite = contenido[1]
    descripcion = contenido.slice(2).join(' — ')
  }

  // 4. CRÍTICO: la detección de urgencia (TRASLADO AL CURADOR) se hace sobre
  //    TODAS las celdas de la fila (no solo trámite+descripción, ni solo lo que
  //    sigue a la fecha). Así el patrón nunca se pierde por haber quedado en una
  //    columna inesperada (etapa, columna extra, o incluso antes de la fecha).
  const textoCompleto = celdas.join(' ')

  return {
    fecha,
    etapa,
    tramite,
    descripcion,
    es_traslado_curador: detectTrasladoCurador(textoCompleto),
  }
}

// (parseAudienciaRow / parseResolucionRow eliminados: audiencias y resoluciones ahora se
//  DERIVAN de los movimientos, ver derivarAudiencias/derivarResoluciones arriba.)

// ============================================================
// HELPERS
// ============================================================

async function clickTab(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el && await el.isVisible()) {
        await el.click()
        return true
      }
    } catch {}
  }
  return false
}

async function findTable(page: Page, selectors: string[]): Promise<any | null> {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el) return el
    } catch {}
  }
  return null
}

async function loadAllPages(page: Page): Promise<void> {
  // Intentar cargar todas las páginas de la tabla (si hay paginación)
  try {
    const showAll = await page.$('a:has-text("Todos"), a:has-text("Ver todo"), select option[value="-1"]')
    if (showAll) {
      await showAll.click()
      await sleep(3000)
    }
  } catch {}
}
