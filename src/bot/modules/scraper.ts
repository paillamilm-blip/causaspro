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
    
    // 2. Extraer movimientos/historial de tramitación
    result.movimientos = await extractMovimientos(page)
    
    // Delay entre tabs (humano)
    await sleep(1500 + Math.random() * 2500)
    
    // 3. Extraer audiencias
    result.audiencias = await extractAudiencias(page)
    
    // Delay entre tabs
    await sleep(1500 + Math.random() * 2500)
    
    // 4. Extraer resoluciones
    result.resoluciones = await extractResoluciones(page)
    
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
 * Extrae la tabla de audiencias
 */
async function extractAudiencias(page: Page): Promise<AudienciaPJUD[]> {
  const audiencias: AudienciaPJUD[] = []
  
  try {
    // Navegar al tab de audiencias
    const tabClicked = await clickTab(page, [
      'a:has-text("Audiencia")',
      'li:has-text("Audiencia") a',
      '#tabAudiencias',
      'a[href*="audiencia"]',
    ])
    
    if (tabClicked) {
      await sleep(2000 + Math.random() * 1500)
    }
    
    // Buscar tabla de audiencias
    const table = await findTable(page, [
      'table:has(th:has-text("Audiencia"))',
      'table:has(th:has-text("Tipo Audiencia"))',
      '#tablaAudiencias',
      '.tabla-audiencias table',
      'table.audiencias',
    ])
    
    if (!table) {
      // Las audiencias pueden estar en la misma página como sección
      const audienciaSection = await page.$('.seccion-audiencias, #audiencias, div:has(h3:has-text("Audiencia"))')
      if (!audienciaSection) {
        log('warn', 'No se encontró sección de audiencias')
        return audiencias
      }
    }
    
    const rows = await (table || page).$$('table:has(th:has-text("Audiencia")) tbody tr, .audiencia-item')
    
    for (const row of rows) {
      try {
        const cells = await row.$$('td')
        if (cells.length < 2) continue
        
        const textos = await Promise.all(cells.map(async (cell: any) => {
          const text = await cell.textContent()
          return cleanText(text)
        }))
        
        const audiencia = parseAudienciaRow(textos)
        if (audiencia) audiencias.push(audiencia)
      } catch {}
    }
    
  } catch (error: any) {
    log('warn', `Error extrayendo audiencias: ${error.message}`)
  }
  
  return audiencias
}

/**
 * Extrae resoluciones
 */
async function extractResoluciones(page: Page): Promise<ResolucionPJUD[]> {
  const resoluciones: ResolucionPJUD[] = []
  
  try {
    // Navegar al tab de resoluciones
    const tabClicked = await clickTab(page, [
      'a:has-text("Resoluc")',
      'li:has-text("Resoluc") a',
      '#tabResoluciones',
      'a[href*="resolucion"]',
    ])
    
    if (tabClicked) {
      await sleep(2000 + Math.random() * 1500)
    }
    
    // Buscar tabla
    const table = await findTable(page, [
      'table:has(th:has-text("Resolución"))',
      'table:has(th:has-text("Resolucion"))',
      '#tablaResoluciones',
      '.tabla-resoluciones table',
    ])
    
    if (!table) return resoluciones
    
    const rows = await table.$$('tbody tr')
    
    for (const row of rows) {
      try {
        const cells = await row.$$('td')
        if (cells.length < 2) continue
        
        const textos = await Promise.all(cells.map(async (cell: any) => {
          const text = await cell.textContent()
          return cleanText(text)
        }))
        
        const resolucion = parseResolucionRow(textos)
        if (resolucion) resoluciones.push(resolucion)
      } catch {}
    }
    
  } catch (error: any) {
    log('warn', `Error extrayendo resoluciones: ${error.message}`)
  }
  
  return resoluciones
}

// ============================================================
// PARSERS DE FILAS
// ============================================================

function parseMovimientoRow(textos: string[]): MovimientoPJUD | null {
  if (textos.length < 2) return null
  
  // Buscar la celda que parece fecha
  let fecha: string | null = null
  let etapa: string | undefined
  let tramite = ''
  let descripcion: string | undefined
  
  for (let i = 0; i < textos.length; i++) {
    const parsed = parsePJUDDate(textos[i])
    if (parsed && !fecha) {
      fecha = parsed
    } else if (!fecha) {
      // Antes de la fecha, ignorar
      continue
    } else if (!tramite) {
      // Primer texto después de la fecha
      if (textos[i].length <= 30 && i === 1) {
        etapa = textos[i] || undefined
      } else {
        tramite = textos[i]
      }
    } else if (!etapa && !descripcion) {
      // Si tramite ya está seteado pero es corto, puede ser etapa
      if (tramite.length <= 30 && textos[i].length > tramite.length) {
        etapa = tramite
        tramite = textos[i]
      } else {
        descripcion = textos[i] || undefined
      }
    } else {
      descripcion = textos[i] || undefined
    }
  }
  
  // Si no encontramos fecha, intentar con el primer campo
  if (!fecha && textos.length >= 3) {
    fecha = parsePJUDDate(textos[0])
    if (fecha) {
      etapa = textos[1] || undefined
      tramite = textos[2] || ''
      descripcion = textos[3] || undefined
    }
  }
  
  if (!fecha || !tramite) return null
  
  return {
    fecha,
    etapa,
    tramite,
    descripcion,
    es_traslado_curador: detectTrasladoCurador(tramite + ' ' + (descripcion || '')),
  }
}

function parseAudienciaRow(textos: string[]): AudienciaPJUD | null {
  if (textos.length < 2) return null
  
  let fecha: string | null = null
  let tipo = ''
  let sala: string | undefined
  let estado: string | undefined
  
  for (let i = 0; i < textos.length; i++) {
    const parsed = parsePJUDDate(textos[i])
    if (parsed && !fecha) {
      fecha = parsed
    } else if (fecha && !tipo) {
      tipo = textos[i]
    } else if (fecha && tipo) {
      if (!sala && textos[i].toLowerCase().includes('sala')) {
        sala = textos[i]
      } else {
        estado = textos[i]
      }
    }
  }
  
  if (!fecha) {
    fecha = parsePJUDDate(textos[0])
    tipo = textos[1] || 'Audiencia'
    sala = textos[2] || undefined
    estado = textos[3] || undefined
  }
  
  if (!fecha) return null
  
  return { fecha, tipo: tipo || 'Audiencia', sala, estado }
}

function parseResolucionRow(textos: string[]): ResolucionPJUD | null {
  if (textos.length < 2) return null
  
  const fecha = parsePJUDDate(textos[0])
  if (!fecha) return null
  
  return {
    fecha,
    tipo: textos[1] || 'Resolución',
    texto_resumen: textos[2] || undefined,
  }
}

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
