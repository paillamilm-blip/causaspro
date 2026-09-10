// ============================================================
// CAUSASPRO BOT - Diagnóstico de la página de DETALLE de causa
// ------------------------------------------------------------
// PROPÓSITO
// El scraper (scraper.ts) usa selectores ADIVINADOS para movimientos,
// audiencias y resoluciones (#tablaAudiencias, table:has(th:has-text(...)),
// tabs por texto "Historial", etc.). Cuando el portal no usa exactamente
// esos nombres, no matchea y devuelve vacío (de ahí "No se encontró sección
// de audiencias" en las 5 causas).
//
// Este módulo NO scrapea: fotografía la ESTRUCTURA REAL del detalle para que
// podamos reescribir los extractores basados en el HTML verdadero (misma
// filosofía que dumpZonaFiltros() en search.ts). Se corre UNA vez contra una
// causa real y produce 2 archivos en bot-capturas/:
//   - detalle_<RIT>.html       → HTML completo de la página de detalle
//   - detalle_<RIT>.resumen.txt → esqueleto legible: tabs, tablas y encabezados
//
// ACTIVACIÓN: se llama desde el orchestrator SOLO si BOT_DIAG_DETALLE=1,
// justo después de abrir el detalle y ANTES de scrapear. Nunca corre en
// producción por defecto y jamás afecta el scraping (todo va envuelto en try).
//
// ⚠️ PRIVACIDAD: el archivo detalle_<RIT>.html contiene datos SENSIBLES de
// causas de familia (nombres de menores, RUTs, partes). Para compartir el
// diagnóstico, envía SOLO el detalle_<RIT>.resumen.txt (estructura: tablas,
// tabs, encabezados) — NUNCA el .html crudo, ni lo adjuntes a issues/PRs.
// En CI el flag se fuerza a '0' (ver .github/workflows/bot-pjud.yml).
// ============================================================

import type { Page } from 'playwright'
import * as fs from 'fs'
import { capturaPath, log, sleep } from '../utils'

/** Estructura serializable del detalle, extraída del DOM real (main world). */
interface DetalleSnapshot {
  url: string
  title: string
  /** Elementos que parecen "tabs" (a/li/button dentro de nav/ul/tablist). */
  tabs: Array<{ tag: string; texto: string; id: string; clase: string; href: string; visible: boolean }>
  /** Cada tabla de la página con sus encabezados y una muestra de filas. */
  tablas: Array<{
    indice: number
    id: string
    clase: string
    visible: boolean
    encabezados: string[]
    numFilas: number
    /** Primeras filas (celdas como texto) para reconocer columnas reales. */
    muestraFilas: string[][]
  }>
  /** Encabezados de sección (h1..h4, legend) para ubicar zonas. */
  encabezados: Array<{ tag: string; texto: string }>
}

/**
 * Recorre el DOM REAL de la página de detalle y devuelve un snapshot
 * estructurado (tabs + tablas + encabezados). No adivina selectores del
 * portal: enumera lo que EXISTE. Toda la lógica corre en el navegador.
 */
async function capturarSnapshot(page: Page): Promise<DetalleSnapshot> {
  return page.evaluate(() => {
    // Shim defensivo (esbuild/tsx con keepNames referencia __name en el navegador).
    // El shim GLOBAL vive en createStealthContext; este local es defensa en profundidad.
    const __name = (x: any) => x
    const esVisible = (e: Element | null): boolean =>
      !!e && (e as HTMLElement).offsetParent !== null
    const txt = (e: Element | null): string => (e?.textContent || '').replace(/\s+/g, ' ').trim()

    // --- TABS: enlaces/li/botones dentro de contenedores de navegación ---
    const tabsSet = new Set<Element>()
    document.querySelectorAll(
      'nav a, nav li, ul.nav a, ul.nav li, [role="tab"], .tab, .tabs a, .nav-tabs a, li.nav-item a'
    ).forEach(e => tabsSet.add(e))
    const tabs = Array.from(tabsSet).map(e => ({
      tag: e.tagName.toLowerCase(),
      texto: txt(e).slice(0, 80),
      id: e.id || '',
      clase: (e.getAttribute('class') || '').slice(0, 120),
      href: (e.getAttribute('href') || '').slice(0, 160),
      visible: esVisible(e),
    })).filter(t => t.texto.length > 0)

    // --- TABLAS: encabezados reales + muestra de filas ---
    const tablas = Array.from(document.querySelectorAll('table')).map((table, indice) => {
      // Encabezados: th donde existan; si no, primera fila de td.
      let encabezados = Array.from(table.querySelectorAll('thead th, tr th'))
        .map(th => txt(th)).filter(Boolean)
      const filas = Array.from(table.querySelectorAll('tbody tr, tr'))
      if (encabezados.length === 0 && filas.length > 0) {
        encabezados = Array.from(filas[0].querySelectorAll('td, th')).map(c => txt(c)).filter(Boolean)
      }
      const muestraFilas = filas.slice(0, 4).map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => txt(td).slice(0, 60))
      ).filter(cols => cols.length > 0)
      return {
        indice,
        id: table.id || '',
        clase: (table.getAttribute('class') || '').slice(0, 120),
        visible: esVisible(table),
        encabezados: encabezados.slice(0, 12),
        numFilas: filas.length,
        muestraFilas,
      }
    })

    // --- ENCABEZADOS de sección ---
    const encabezados = Array.from(document.querySelectorAll('h1, h2, h3, h4, legend'))
      .map(h => ({ tag: h.tagName.toLowerCase(), texto: txt(h).slice(0, 100) }))
      .filter(h => h.texto.length > 0)

    return {
      url: location.href,
      title: document.title,
      tabs,
      tablas,
      encabezados,
    }
  })
}

/** Convierte el snapshot en un resumen legible en texto plano. */
function formatearResumen(rit: string, snap: DetalleSnapshot): string {
  const L: string[] = []
  L.push('============================================================')
  L.push(`DIAGNÓSTICO DETALLE DE CAUSA — ${rit}`)
  L.push(`URL:   ${snap.url}`)
  L.push(`Título: ${snap.title}`)
  L.push('============================================================')
  L.push('')

  L.push(`ENCABEZADOS DE SECCIÓN (${snap.encabezados.length}):`)
  snap.encabezados.forEach(h => L.push(`  <${h.tag}> ${h.texto}`))
  L.push('')

  L.push(`TABS / NAVEGACIÓN (${snap.tabs.length}):`)
  snap.tabs.forEach(t => {
    const vis = t.visible ? 'visible' : 'oculto'
    L.push(`  [${vis}] <${t.tag}> "${t.texto}"  id="${t.id}" href="${t.href}" class="${t.clase}"`)
  })
  L.push('')

  L.push(`TABLAS (${snap.tablas.length}):`)
  snap.tablas.forEach(tb => {
    const vis = tb.visible ? 'visible' : 'oculto'
    L.push(`  ── Tabla #${tb.indice} [${vis}] id="${tb.id}" class="${tb.clase}" filas=${tb.numFilas}`)
    L.push(`     Encabezados: ${tb.encabezados.length ? tb.encabezados.join(' | ') : '(sin th)'}`)
    tb.muestraFilas.forEach((cols, i) => {
      L.push(`     Fila ${i}: ${cols.join('  ·  ')}`)
    })
  })
  L.push('')
  L.push('SUGERENCIA: identificá qué tabla es movimientos/audiencias/resoluciones')
  L.push('por sus encabezados y filas, y compartí este resumen para reescribir')
  L.push('los extractores con la estructura REAL.')
  return L.join('\n')
}

/**
 * Vuelca a bot-capturas/ el HTML completo y un resumen estructurado de la
 * página de DETALLE de la causa. Debe llamarse cuando la page ya está en el
 * detalle. Es totalmente defensivo: cualquier fallo se traga y se loguea,
 * nunca interrumpe el flujo del bot.
 *
 * @returns rutas de los archivos escritos (o vacío si no se pudo)
 */
export async function volcarDetalleParaDiagnostico(
  page: Page,
  rit: string,
): Promise<{ htmlPath?: string; resumenPath?: string }> {
  const seguro = rit.replace(/[^a-zA-Z0-9._-]/g, '_')
  const salida: { htmlPath?: string; resumenPath?: string } = {}

  try {
    // Pequeña espera para asegurar que el tab por defecto y las tablas cargaron.
    await sleep(1500)

    // 1) HTML completo de la página de detalle (todo el documento renderizado).
    try {
      const html = await page.content()
      const htmlPath = capturaPath(`detalle_${seguro}.html`)
      fs.writeFileSync(htmlPath, html, 'utf8')
      salida.htmlPath = htmlPath
      log('info', `  [DIAG-DETALLE] HTML completo guardado: ${htmlPath} (${html.length} bytes)`)
    } catch (e: any) {
      log('warn', `  [DIAG-DETALLE] No se pudo guardar el HTML: ${e?.message ?? e}`)
    }

    // 2) Resumen estructurado (tabs + tablas + encabezados) legible.
    try {
      const snap = await capturarSnapshot(page)
      const resumen = formatearResumen(rit, snap)
      const resumenPath = capturaPath(`detalle_${seguro}.resumen.txt`)
      fs.writeFileSync(resumenPath, resumen, 'utf8')
      salida.resumenPath = resumenPath
      log('info', `  [DIAG-DETALLE] Resumen guardado: ${resumenPath}`)
      log('info', `  [DIAG-DETALLE] ${snap.tablas.length} tablas, ${snap.tabs.length} tabs detectados`)
    } catch (e: any) {
      log('warn', `  [DIAG-DETALLE] No se pudo generar el resumen: ${e?.message ?? e}`)
    }
  } catch (e: any) {
    log('warn', `  [DIAG-DETALLE] Diagnóstico abortado (sin efecto en el scraping): ${e?.message ?? e}`)
  }

  return salida
}
