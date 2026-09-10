// ============================================================
// CAUSASPRO BOT - Search Module (via Mis Causas > Familia)
// ULTRA REVIEW FIX: 9 bugs corregidos
// ============================================================

import type { Page } from 'playwright'
import type { CausaToScrape } from '../types'
import { sleep, log, parseRIT, capturaPath } from '../utils'

// El diagnóstico detallado (que puede volcar nombres de partes/causas al log) se activa
// por defecto en local, pero se puede desactivar con BOT_DIAG=0 (así lo hace el CI, para
// no filtrar datos sensibles a los logs públicos de GitHub Actions).
const DIAG_ON = process.env.BOT_DIAG !== '0'

// ============================================================
// HELPER: Click en tab Familia (usado en múltiples lugares)
// Busca en TODOS los tipos de elementos
// ============================================================
async function clickFamiliaTab(page: Page): Promise<boolean> {
  const result = await page.evaluate(() => {
    // Buscar en absolutamente todos los elementos
    const allElements = document.querySelectorAll('a, button, li, span, div, td, th, label')
    
    // Método 1: Buscar en contenedor que tiene los otros tabs
    const containers = document.querySelectorAll('ul, nav, div, ol')
    for (const container of containers) {
      const text = container.textContent || ''
      if (text.includes('Corte Suprema') && text.includes('Civil') && text.includes('Familia')) {
        const children = container.querySelectorAll('a, li, button, span, div')
        for (const child of children) {
          const childText = (child.textContent || '').trim()
          if (childText === 'Familia') {
            (child as HTMLElement).click()
            return `container: ${child.tagName}`
          }
        }
      }
    }
    
    // Método 2: Buscar texto directo "Familia" en cualquier elemento
    for (const el of allElements) {
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent?.trim())
        .join('')
      if (directText === 'Familia') {
        (el as HTMLElement).click()
        return `direct: ${el.tagName}`
      }
    }
    
    // Método 3: textContent === 'Familia'
    for (const el of allElements) {
      if ((el.textContent || '').trim() === 'Familia') {
        (el as HTMLElement).click()
        return `text: ${el.tagName}`
      }
    }
    
    return null
  })
  
  if (result) {
    log('info', `  Tab Familia: ${result}`)
    return true
  }
  
  log('warn', '  Tab Familia: NO encontrado')
  return false
}

// ============================================================
// HELPER: Verificar que estamos en tab Familia
// Chequea en la TABLA específica, no en body.textContent
// ============================================================
async function verifyFamiliaTab(page: Page, maxWaitMs: number = 15000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const inFamilia = await page.evaluate(() => {
      // Verificar en las tablas de datos (no en menú/sidebar)
      const tables = document.querySelectorAll('table')
      for (const table of tables) {
        const rows = table.querySelectorAll('td')
        for (const td of rows) {
          const text = td.textContent || ''
          if (text.includes('Juzgado de Familia') || text.includes('Familia Santiago') || 
              text.includes('Familia San Miguel') || text.includes('Familia Talcahuano') ||
              text.includes('Centro de Medidas Cautelares')) {
            return true
          }
        }
      }
      return false
    })
    
    if (inFamilia) return true
    await sleep(2000)
  }
  return false
}

// ============================================================
// MAIN: Navega a Mis Causas > Familia
// ============================================================
export async function navigateToConsulta(page: Page): Promise<boolean> {
  log('info', 'Navegando a Mis Causas...')
  
  try {
    // Click en "Mis Causas" del menú
    const clicked = await page.evaluate(() => {
      const links = document.querySelectorAll('a')
      for (const link of links) {
        if ((link.textContent || '').trim() === 'Mis Causas' || (link.textContent || '').trim() === 'Mis causas') {
          link.click()
          return true
        }
      }
      return false
    })
    
    if (!clicked) {
      // NO usar page.goto() — pierde la sesión
      // Intentar buscar el link de Mis Causas de otra forma
      await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="indexN"], a[href*="mis_causas"]')
        if (links.length > 0) (links[0] as HTMLElement).click()
      })
    }
    
    await sleep(5000)
    
    // Click en tab Familia — usar click en el enlace #familiaTab
    // IMPORTANTE: NO usar page.goto() porque pierde la sesión
    log('info', '  Seleccionando tab Familia...')
    
    // Primero intentar click real de Playwright en #familiaTab
    let familiaOk = false
    try {
      await page.click('#familiaTab', { timeout: 5000 })
      log('info', '  ✓ Click #familiaTab OK')
      familiaOk = true
    } catch {
      // Si no encuentra por ID, buscar con JS
      const jsResult = await clickFamiliaTab(page)
      if (jsResult) familiaOk = true
    }
    
    if (!familiaOk) {
      // Último recurso: evaluar un click directo en el link con href que contiene tab7
      await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="tab7"], a[id*="familia"], a[id*="Familia"]')
        if (links.length > 0) (links[0] as HTMLElement).click()
      })
    }
    
    await sleep(5000)
    
    // Verificar que Familia cargó en la TABLA
    const verified = await verifyFamiliaTab(page, 15000)
    
    if (verified) {
      log('success', '  ✓ En Mis Causas > Familia (verificado en tabla)')
    } else {
      log('warn', '  ⚠️ Familia no confirmado en tabla, intentando click...')
      await clickFamiliaTab(page)
      await sleep(5000)
      // Tomar screenshot para debug
      { const p = capturaPath('bot_error_familia_fail.png'); await page.screenshot({ path: p }).catch(() => {}); log('info', `  Screenshot guardado: ${p}`) }
    }
    
    return true
    
  } catch (error: any) {
    log('error', `Error navegando a Mis Causas: ${error.message}`)
    return false
  }
}

// ============================================================
// HELPER: Activar el toggle "Filtros" (switch verde junto a "Filtros").
// El switch tiene el <input type=checkbox> OCULTO (display:none / opacity:0), por eso
// clickear el input directo no sirve (offsetParent === null) y el click JS no dispara
// los handlers del framework. Estrategia robusta:
//   1) localizar el elemento clickeable VISIBLE del switch cerca del texto "Filtros"
//      y marcarlo con un atributo temporal;
//   2) hacer un CLICK REAL de Playwright sobre él (dispara eventos como un humano);
//   3) verificar que el input quedó checked; si no, reintentar.
// ============================================================
async function activarFiltros(page: Page): Promise<boolean> {
  const MARK = 'data-bot-filtros-toggle'
  const limpiarMarca = () => page.evaluate((mark: string) => {
    document.querySelectorAll(`[${mark}]`).forEach(e => e.removeAttribute(mark))
  }, MARK).catch(() => {})

  // Estado del switch por MÚLTIPLES señales (no dependemos de un <input checkbox>, porque el
  // toggle del PJUD puede no tener uno accesible). Señales de "activo":
  //   - input[type=checkbox].checked  |  aria-checked="true"  |  data-checked/data-on
  //   - clase que sugiera encendido (active/on/checked/enabled/selected) en el propio nodo
  //     o en un descendiente típico de switch
  //   null solo si de verdad no hay ninguna señal legible.
  const leerEstado = async (): Promise<boolean | null> => page.evaluate((mark: string) => {
    // NOTA: el shim GLOBAL de __name está en createStealthContext (login.ts) y cubre TODOS
    // los page.evaluate. Este const local es defensa en profundidad; no es obligatorio en
    // cada evaluate. (esbuild/tsx con keepNames referencia __name dentro del navegador.)
    const __name = (x: any) => x
    const el = document.querySelector(`[${mark}]`) as HTMLElement | null
    if (!el) return null
    const scope = el.closest('label, .custom-switch, .custom-control, .form-switch, .form-check, [role="switch"], .switch, .toggle, div') || el
    // 1) checkbox real
    const cb = (el.matches('input[type="checkbox"]') ? el : scope.querySelector('input[type="checkbox"]')) as HTMLInputElement | null
    if (cb) return cb.checked
    // 2) aria-checked / data-*
    const aria = el.getAttribute('aria-checked') || scope.querySelector('[aria-checked]')?.getAttribute('aria-checked')
    if (aria === 'true') return true
    if (aria === 'false') return false
    const data = el.getAttribute('data-checked') || el.getAttribute('data-on') || el.getAttribute('data-state')
    if (data != null) return /^(true|on|checked|1)$/i.test(data)
    // 3) clases del propio nodo o de un descendiente "switch/slider/toggle"
    const claseActiva = (n: Element | null) => !!n && /(?:^|[\s_-])(active|on|checked|enabled|selected)(?:$|[\s_-])/i.test(n.className || '')
    if (claseActiva(el)) return true
    const sub = scope.querySelector('.slider, .switch, .toggle, [class*="switch"], [class*="toggle"], [class*="slider"]')
    if (claseActiva(sub)) return true
    return null
  }, MARK)

  // 1) Marcar el elemento clickeable del switch a partir del TEXTO "Filtros".
  //    Estrategia genérica (no depende de clases del framework): ubicar el nodo cuyo texto
  //    propio sea "Filtros" y, desde su contenedor, tomar el control interactivo asociado —
  //    normalmente el elemento hermano/cercano a la DERECHA del label (el switch). Si el
  //    contenedor tiene un input/[role=switch]/label-for, se prefiere ese.
  const found = await page.evaluate((mark: string) => {
    const __name = (x: any) => x  // ver nota sobre esbuild/keepNames arriba
    document.querySelectorAll(`[${mark}]`).forEach(e => e.removeAttribute(mark))
    const esVisible = (e: Element | null): e is HTMLElement => !!e && (e as HTMLElement).offsetParent !== null

    // Nodos cuyo TEXTO PROPIO (sin contar hijos) es "Filtros".
    const nodosFiltros: Element[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    let n = walker.nextNode() as Element | null
    while (n) {
      const propio = Array.from(n.childNodes)
        .filter(c => c.nodeType === 3)
        .map(c => (c.textContent || '').trim())
        .join('')
      if (/^filtros?$/i.test(propio) && esVisible(n)) nodosFiltros.push(n)
      n = walker.nextNode() as Element | null
    }

    const marcar = (el: Element | null): boolean => {
      if (esVisible(el)) { (el as HTMLElement).setAttribute(mark, '1'); return true }
      return false
    }

    for (const label of nodosFiltros) {
      // a) ¿el label apunta a un control con for=?
      const forId = label.getAttribute('for')
      if (forId) {
        const target = document.getElementById(forId)
        // el input suele estar oculto; en ese caso clickeamos el propio label (visible)
        if (target && esVisible(target) && marcar(target)) return 'for-visible'
        if (marcar(label)) return 'label-for'
      }
      // b) el contenedor del label: buscar el control interactivo (switch) a la derecha.
      const cont = label.closest('div, li, td, th, span, label') || label
      // candidatos dentro del contenedor: switch/toggle/checkbox/role=switch/button
      const interno = cont.querySelector(
        '[role="switch"], input[type="checkbox"], .switch, .toggle, [class*="switch"], [class*="toggle"], button'
      )
      if (interno) {
        // si es un input oculto, clickeamos su contenedor visible más cercano
        if (esVisible(interno) && marcar(interno)) return 'interno'
        const wrap = interno.closest('label, span, div')
        if (marcar(wrap)) return 'interno-wrap'
      }
      // c) hermano SIGUIENTE del label (el switch suele ir justo a la derecha)
      let sib = label.nextElementSibling
      let hop = 0
      while (sib && hop < 3) {
        if (esVisible(sib)) {
          const s = sib.querySelector('[role="switch"], input[type="checkbox"], .switch, .toggle, [class*="switch"], [class*="toggle"], button') || sib
          if (marcar(s)) return 'hermano'
          if (marcar(sib)) return 'hermano-cont'
        }
        sib = sib.nextElementSibling
        hop++
      }
      // d) último recurso: clickear el propio label
      if (marcar(label)) return 'label-mismo'
    }
    return false
  }, MARK)

  if (!found) {
    log('warn', '  Toggle "Filtros" no encontrado (por texto "Filtros" visible).')
    await dumpZonaFiltros(page)
    return false
  }
  log('info', `  Toggle "Filtros" localizado (${found}).`)

  // Si ya está activo, no hacemos nada.
  if ((await leerEstado()) === true) {
    await limpiarMarca()
    log('info', '  Filtros ya estaban activos.')
    return true
  }

  // ¿El elemento marcado es INEQUÍVOCAMENTE el switch? Solo entonces usamos force:true
  // (que salta los chequeos de "actionability"); si marcamos un contenedor genérico, forzar
  // podría clickear algo equivocado, así que preferimos scroll + click normal.
  const marcadoEsSwitch = await page.evaluate((mark: string) => {
    const el = document.querySelector(`[${mark}]`)
    return !!el && el.matches('[role="switch"], input[type="checkbox"]')
  }, MARK).catch(() => false)

  // 2) Click sobre el elemento marcado. Alternamos click real de Playwright y click JS, y
  //    reintentamos hasta 4 veces verificando el estado por múltiples señales.
  let noVerificable = false
  for (let intento = 1; intento <= 4; intento++) {
    try {
      await page.locator(`[${MARK}]`).scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {})
      // force solo si el marcado es el switch en sí y ya reintentamos una vez.
      await page.click(`[${MARK}]`, { timeout: 3000, force: intento >= 2 && marcadoEsSwitch })
    } catch {
      await page.evaluate((mark: string) => {
        const el = document.querySelector(`[${mark}]`) as HTMLElement | null
        el?.click()
      }, MARK)
    }
    await sleep(1200)
    const estado = await leerEstado()
    if (estado === true) {
      await limpiarMarca()
      log('info', `  ✓ Filtros activados (intento ${intento}).`)
      return true
    }
    if (estado === null) noVerificable = true
    log('info', `  Filtros aún no confirmados, reintentando (${intento}/4)...`)
  }

  if (noVerificable) {
    log('warn', '  Se clickeó "Filtros" pero no se pudo verificar su estado.')
  } else {
    log('warn', '  No se pudo activar "Filtros" tras 4 intentos.')
  }
  await dumpZonaFiltros(page)
  await limpiarMarca()
  return false
}

/**
 * DIAGNÓSTICO: vuelca al log el HTML de la zona alrededor del texto "Filtros" para ver
 * cómo está construido el toggle real del portal (etiquetas, clases, atributos). Solo se
 * llama cuando la activación falla, y solo si BOT_DIAG !== '0'.
 */
async function dumpZonaFiltros(page: Page): Promise<void> {
  if (!DIAG_ON) return
  try {
    const html = await page.evaluate(() => {
      const __name = (x: any) => x  // ver nota sobre esbuild/keepNames arriba
      const esVisible = (e: Element | null) => !!e && (e as HTMLElement).offsetParent !== null
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
      let n = walker.nextNode() as Element | null
      while (n) {
        const propio = Array.from(n.childNodes).filter(c => c.nodeType === 3).map(c => (c.textContent || '').trim()).join('')
        if (/^filtros?$/i.test(propio) && esVisible(n)) {
          // subir 2 niveles para capturar el contenedor del label + el switch
          const cont = (n.parentElement?.parentElement || n.parentElement || n)
          return (cont as HTMLElement).outerHTML.slice(0, 1500)
        }
        n = walker.nextNode() as Element | null
      }
      return '(no se encontró un nodo con texto propio "Filtros")'
    })
    log('info', `  [DIAG] HTML de la zona "Filtros":`)
    log('info', `    ${html.replace(/\s+/g, ' ').slice(0, 1200)}`)
  } catch (e: any) {
    log('warn', `  [DIAG] No se pudo volcar la zona de Filtros: ${e.message}`)
  }
}

// ============================================================
// HELPER: Open a custom dropdown, click "Seleccionar Todos", and close it properly
// Uses the trigger element to open/close (toggle) instead of document.body.click()
// ============================================================
async function selectAllInDropdown(page: Page, dropdownLabel: string): Promise<void> {
  // Step 1: Find and click the dropdown trigger to OPEN it
  const triggerFound = await page.evaluate((label: string) => {
    const lowerLabel = label.toLowerCase()
    const dropdowns = document.querySelectorAll(
      'select, .multiselect, [class*="select"], [class*="multiSelect"], button[data-toggle], .dropdown-toggle, [class*="dropdown"]'
    )
    for (const dd of dropdowns) {
      if ((dd as HTMLElement).offsetParent === null) continue
      const nearText = (dd.closest('div, td, .form-group')?.textContent || '').toLowerCase()
      const prevLabel = dd.closest('div')?.previousElementSibling?.textContent?.toLowerCase() || ''
      if (nearText.includes(lowerLabel) || prevLabel.includes(lowerLabel)) {
        (dd as HTMLElement).click()
        return 'found'
      }
    }
    // Fallback by index: Tipo Causa is the first visible, Estado is the second
    const allDropdowns = document.querySelectorAll('.multiSelect, [class*="multiselect"], [class*="select"]')
    const visible = Array.from(allDropdowns).filter(d => (d as HTMLElement).offsetParent !== null)
    if (lowerLabel.includes('tipo') && visible.length >= 1) {
      (visible[0] as HTMLElement).click()
      return 'fallback-0'
    }
    if (lowerLabel.includes('estado') && visible.length >= 2) {
      (visible[1] as HTMLElement).click()
      return 'fallback-1'
    }
    return null
  }, dropdownLabel)

  if (!triggerFound) {
    log('warn', `  Dropdown "${dropdownLabel}" trigger not found`)
    return
  }

  // Step 2: Wait for dropdown panel to appear
  await sleep(500)

  // Step 3: Click "Seleccionar Todos" within the open dropdown panel
  await page.evaluate(() => {
    // First try to find within an open dropdown panel/menu
    const panels = document.querySelectorAll(
      '.dropdown-menu, [class*="dropdown-content"], [class*="multiselect-content"], [class*="options"], [class*="panel"], [role="listbox"], [class*="menu"]'
    )
    for (const panel of panels) {
      if ((panel as HTMLElement).offsetParent === null) continue
      const items = panel.querySelectorAll('button, a, span, div, label, li')
      for (const item of items) {
        const text = (item.textContent || '').trim()
        if (text === 'Seleccionar Todos' || text === 'Seleccionar todos') {
          (item as HTMLElement).click()
          return
        }
      }
    }
    // Fallback: any visible "Seleccionar Todos" on page
    const allButtons = document.querySelectorAll('button, a, span, div, label, li')
    for (const btn of allButtons) {
      if ((btn as HTMLElement).offsetParent === null) continue
      const text = (btn.textContent || '').trim()
      if (text === 'Seleccionar Todos' || text === 'Seleccionar todos') {
        (btn as HTMLElement).click()
        return
      }
    }
  })

  // Step 4: Wait for selection to register
  await sleep(500)

  // Step 5: Close dropdown by pressing Escape (does NOT deselect like body.click might)
  await page.keyboard.press('Escape')
  await sleep(300)

  // Verify closure: if dropdown panel is still open, click the trigger again to toggle it closed
  const stillOpen = await page.evaluate((label: string) => {
    const panels = document.querySelectorAll(
      '.dropdown-menu.show, [class*="multiselect-content"]:not([style*="display: none"]), [class*="open"], [class*="active"]'
    )
    for (const panel of panels) {
      if ((panel as HTMLElement).offsetParent !== null) return true
    }
    return false
  }, dropdownLabel)

  if (stillOpen) {
    log('info', `  Dropdown "${dropdownLabel}" aun abierto tras Escape, re-click para cerrar`)
    // Re-click the trigger to close it
    await page.evaluate((label: string) => {
      const lowerLabel = label.toLowerCase()
      const dropdowns = document.querySelectorAll(
        'select, .multiselect, [class*="select"], [class*="multiSelect"], button[data-toggle], .dropdown-toggle, [class*="dropdown"]'
      )
      for (const dd of dropdowns) {
        if ((dd as HTMLElement).offsetParent === null) continue
        const nearText = (dd.closest('div, td, .form-group')?.textContent || '').toLowerCase()
        const prevLabel = dd.closest('div')?.previousElementSibling?.textContent?.toLowerCase() || ''
        if (nearText.includes(lowerLabel) || prevLabel.includes(lowerLabel)) {
          (dd as HTMLElement).click()
          return
        }
      }
    }, dropdownLabel)
    await sleep(300)
  } else {
    // The close-verification selectors may not match the portal's actual DOM structure.
    // If the portal uses different state indicators, this check is inconclusive.
    log('info', `  Dropdown "${dropdownLabel}" cerrado (o estado no determinable por selectores CSS)`)
  }
}

// ============================================================
// BUSCAR: Activa filtros del tab Familia y busca
// IMPORTANTE: Esperar a que el formulario de Familia cargue antes de interactuar
// ORDEN CORRECTO: 1) Familia tab, 2) Filtros, 3) Tipo Causa (5/5), 4) Estado (12/12), 5) Año, 6) Buscar
// ============================================================
export async function searchByYear(page: Page, year: string): Promise<CausaFoundInPortal[]> {
  log('info', `  Buscando causas del año ${year}...`)
  
  try {
    // PASO 1: Esperar a que el formulario de Familia esté completamente cargado
    // (después del click en #familiaTab, el form tarda en cargar)
    await sleep(3000)
    
    // PASO 2: Activar Filtros (toggle dentro del tab Familia)
    log('info', '  Activando filtros...')
    const filtrosOk = await activarFiltros(page)
    if (!filtrosOk) {
      log('warn', '  ⚠️ No se confirmó la activación de "Filtros"; los dropdowns Tipo/Estado podrían no estar disponibles.')
    }
    await sleep(2000)

    // PASO 2.5: Limpiar campo RUT (auto-rellenado con RUT del curador tras login)
    // Las causas NO estan asociadas al RUT sino al RIT asignado por la jefa.
    // Si el RUT queda con valor, la busqueda filtra por ese RUT y retorna 0 resultados.
    // El formulario tiene 2 inputs de RUT: el numero principal y el digito verificador.
    log('info', '  Limpiando campo Rut (no filtrar por RUT del curador)...')
    await page.evaluate(() => {
      const inputs = document.querySelectorAll('input')
      for (const input of inputs) {
        if ((input as HTMLElement).offsetParent === null) continue // Solo visibles
        const name = (input.getAttribute('name') || '').toLowerCase()
        const id = (input.getAttribute('id') || '').toLowerCase()
        const ph = (input.getAttribute('placeholder') || '').toLowerCase()
        // Match inputs related to RUT: main number field and verification digit
        if (name.includes('rut') || id.includes('rut') || ph.includes('rut') ||
            name.includes('dv') || id.includes('dv')) {
          (input as HTMLInputElement).value = ''
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }
    })
    await sleep(500)
    
    // PASO 3: Tipo Causa → Click dropdown → "Seleccionar Todos" (5 de 5)
    // MUST come FIRST before Estado
    log('info', '  Seleccionando Tipo Causa (5 de 5)...')
    await selectAllInDropdown(page, 'tipo')
    await sleep(500)
    
    // PASO 4: Estado → Click dropdown → "Seleccionar Todos" (12 de 12)
    // MUST come SECOND after Tipo Causa
    log('info', '  Seleccionando Estado (12 de 12)...')
    await selectAllInDropdown(page, 'estado')
    await sleep(500)
    
    // PASO 5: Año — solo inputs VISIBLES
    log('info', `  Año: ${year}...`)
    await page.evaluate((y: string) => {
      const inputs = document.querySelectorAll('input')
      for (const input of inputs) {
        if ((input as HTMLElement).offsetParent === null) continue // Solo visibles
        const name = (input.getAttribute('name') || '').toLowerCase()
        const id = (input.getAttribute('id') || '').toLowerCase()
        const ph = (input.getAttribute('placeholder') || '').toLowerCase()
        if (name.includes('ano') || name.includes('año') || id.includes('ano') || ph.includes('año')) {
          (input as HTMLInputElement).value = y
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return
        }
      }
    }, year)
    await sleep(1000)
    
    // PASO 6: Click Buscar — SOLO el botón VISIBLE (del tab Familia)
    log('info', '  Click en Buscar (tab Familia)...')
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button, input[type="submit"], input[type="button"]')
      for (const btn of btns) {
        if ((btn as HTMLElement).offsetParent === null) continue // Solo visibles
        const text = (btn.textContent || '').trim()
        const val = (btn as HTMLInputElement).value || ''
        if (text === 'Buscar' || val === 'Buscar') {
          (btn as HTMLElement).click()
          return
        }
      }
    })
    
    // PASO 7: Esperar resultados con polling (hasta 60s por defecto, check cada 2s)
    // 16000+ registros puede tardar bastante - configurable via BOT_POLL_TIMEOUT
    const pollTimeout = process.env.BOT_POLL_TIMEOUT ? parseInt(process.env.BOT_POLL_TIMEOUT) * 1000 : 60000
    log('info', `  Esperando resultados (polling hasta ${pollTimeout / 1000}s)...`)
    let resultsFound = false
    const pollStart = Date.now()
    const pollInterval = 2000

    while (Date.now() - pollStart < pollTimeout) {
      const hasRows = await page.evaluate(() => {
        const tables = document.querySelectorAll('table')
        for (const table of tables) {
          const trs = table.querySelectorAll('tbody tr, tr')
          for (const tr of trs) {
            const tds = tr.querySelectorAll('td')
            if (tds.length < 4) continue
            const cells = Array.from(tds).map(td => (td.textContent || '').trim())
            for (const cell of cells) {
              // Match RIT pattern: C-4875-2025, P-7940-2026, F-3069-2026, FA-123-2024, 44977-2026
              if (cell.match(/^[A-Z]{0,3}-?\d+-\d{4}$/)) return true
            }
          }
        }
        return false
      })

      if (hasRows) {
        resultsFound = true
        log('info', `  Resultados detectados en ${Math.round((Date.now() - pollStart) / 1000)}s`)
        break
      }
      await sleep(pollInterval)
    }

    if (!resultsFound) {
      log('warn', `  No se encontraron resultados tras ${pollTimeout / 1000}s de polling para año ${year}`)
      { const p = capturaPath(`bot_error_buscar_${year}.png`); await page.screenshot({ path: p }).catch(() => {}); log('info', `  Screenshot guardado: ${p}`) }
    }
    
    // PASO 8: Leer tabla de resultados
    const causas = await readResultsTable(page)
    
    if (causas.length > 0) {
      log('info', `  Datos: ${causas.slice(0, 3).map(c => `${c.rit}[${c.tribunal.substring(0,25)}]`).join(', ')}`)
    }
    
    // Filtrar solo Familia (por si acaso)
    const causasFamilia = causas.filter(c => {
      const trib = c.tribunal.toLowerCase()
      if (trib.includes('familia') || trib.includes('medida') || trib.includes('cautelar')) return true
      if (/^[A-Z]{1,3}-\d+-\d{4}$/.test(c.rit)) return true
      return false
    })
    
    if (causasFamilia.length < causas.length) {
      log('info', `  Filtrado: ${causas.length} → ${causasFamilia.length} de Familia`)
    }
    
    log('info', `  → ${causasFamilia.length} causas de FAMILIA para ${year}`)

    // PASO 9: Re-click Familia tab para resetear estado para la siguiente busqueda
    log('info', '  Re-click Familia tab (reset para siguiente año)...')
    await clickFamiliaTab(page)
    await sleep(2000)

    return causasFamilia
    
  } catch (error: any) {
    log('error', `Error buscando año ${year}: ${error.message}`)
    await page.screenshot({ path: capturaPath(`bot_error_search_${year}.png`) }).catch(() => {})
    return []
  }
}

// ============================================================
// BÚSQUEDA POR RIT INDIVIDUAL (anti-CAPTCHA)
// ============================================================
// En vez de listar TODO el portal con filtros masivos (5/5, 12/12) que devuelve
// ~17.500 registros y dispara el CAPTCHA, se busca UNA causa concreta llenando SOLO
// el campo "Rol" (el número del RIT). NO se toca el dropdown "Rit" (letra) ni el
// campo "Año" — daban problemas y no son necesarios para acotar. La letra y el año
// se usan solo al final para FILTRAR y quedarse con la causa exacta (Opción A).
// Devuelve la coincidencia exacta y se parece a lo que hace un humano.
// ============================================================
export async function searchByRitExacto(page: Page, rit: string): Promise<CausaFoundInPortal[]> {
  const parsed = parseRIT(rit)
  if (!parsed) {
    log('warn', `  RIT "${rit}" no tiene formato válido (TIPO-NÚMERO-AÑO), se omite`)
    return []
  }
  const { tipo, numero, año } = parsed
  const ritLegible = tipo ? `${tipo}-${numero}-${año}` : `${numero}-${año}`
  log('info', `  Buscando RIT exacto: ${ritLegible}...`)

  try {
    // PASO 0: RE-FORZAR el tab Familia antes de cada búsqueda. navigateToConsulta
    // selecciona Familia una sola vez al inicio, pero entre causa y causa el foco/formulario
    // puede quedar en otra competencia (Corte Suprema, etc.), y la búsqueda terminaría
    // corriendo/leyendo fuera de Familia (bug de "resultados de Corte Suprema"). Es barato
    // e idempotente: si ya estamos en Familia, el click no molesta.
    await clickFamiliaTab(page)
    await sleep(1000)
    // Verificar que quedamos en Familia y, si no, reintentar el click una vez.
    // NOTA: verifyFamiliaTab confirma buscando nombres de juzgado en celdas de tabla, que
    // aún NO existen antes de que una búsqueda pinte resultados. Por eso, en la PRIMERA
    // búsqueda es normal que no confirme: NO es un error (la selección de tabla por
    // contenido en readResultsTable es la salvaguarda final). Por eso el log es 'info'.
    if (!(await verifyFamiliaTab(page, 8000))) {
      log('info', '  Tab Familia no confirmado por contenido (normal antes de tener resultados); reintentando click...')
      await clickFamiliaTab(page)
      await sleep(1500)
    }

    // PASO 1: Esperar a que el formulario de Familia esté cargado
    await sleep(2000)

    // PASO 2.1: Activar el toggle de "Filtros" PRIMERO (igual que searchByYear). Sin esto,
    // los dropdowns de Tipo Causa / Estado pueden no estar disponibles.
    log('info', '  Activando filtros...')
    const filtrosOk = await activarFiltros(page)
    if (!filtrosOk) {
      log('warn', '  ⚠️ No se confirmó la activación de "Filtros"; los dropdowns Tipo/Estado podrían no estar disponibles y la causa podría no aparecer.')
    }
    await sleep(2000)

    // NOTA: NO se toca el campo RUT. El portal lo llena por defecto (RUT del curador) y así
    // es como debe quedar para que la búsqueda funcione; borrarlo era innecesario y
    // contraproducente. Antes había un PASO que lo limpiaba — se eliminó a propósito.

    // PASO 2.3: Tipo Causa → abrir dropdown → "Seleccionar Todos" (deja "5 de 5").
    // CRÍTICO: el portal NO devuelve la causa si estos filtros multi-selección no están
    // completos. searchByYear ya lo hacía; searchByRitExacto no, y por eso no encontraba nada.
    log('info', '  Seleccionando Tipo Causa (5 de 5)...')
    await selectAllInDropdown(page, 'tipo')
    await sleep(500)

    // PASO 2.4: Estado → abrir dropdown → "Seleccionar Todos" (deja "12 de 12").
    log('info', '  Seleccionando Estado (12 de 12)...')
    await selectAllInDropdown(page, 'estado')
    await sleep(500)

    // PASO 3: Escribir el número en el campo "Rol".
    // NO se toca el dropdown "Rit" (letra): buscamos por número + año, que es lo que el
    // portal necesita para encontrar la causa. La letra se usa solo al final para FILTRAR
    // el resultado correcto (PASO 9), así no se confunde con causas de otro tipo.
    // DIAGNÓSTICO (BOT_DIAG_DETALLE=1): volcar SIEMPRE los inputs visibles del formulario
    // de Familia ANTES de escribir, para ver cómo se llaman realmente los campos (Rol/Año).
    // El síntoma observado (3 causas activas dan "No existen causas" tras escribir solo el
    // Año) apunta a que el campo "Rol" no se está llenando porque no matchea name/id "rol".
    if (process.env.BOT_DIAG_DETALLE === '1') {
      log('info', '  [DIAG-FORM] Campos del formulario de Familia ANTES de escribir Rol:')
      await dumpInputsVisibles(page)
    }

    const rolOk = await page.evaluate((rol: string) => {
      const __name = (x: any) => x  // ver nota sobre esbuild/keepNames arriba
      const inputs = document.querySelectorAll('input')
      for (const input of inputs) {
        if ((input as HTMLElement).offsetParent === null) continue
        const name = (input.getAttribute('name') || '').toLowerCase()
        const id = (input.getAttribute('id') || '').toLowerCase()
        const ph = (input.getAttribute('placeholder') || '').toLowerCase()
        if (name.includes('rol') || id.includes('rol') || ph === 'rol') {
          (input as HTMLInputElement).value = rol
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          // Devolver dónde se escribió, para diagnóstico honesto.
          return { ok: true, campo: `name="${name}" id="${id}" ph="${ph}"` }
        }
      }
      return { ok: false, campo: '' }
    }, numero)
    if (!rolOk.ok) {
      log('warn', `  No se encontró el campo "Rol" para escribir el número ${numero} — se omite ${rit}`)
      { const p = capturaPath(`bot_error_rol_${numero}.png`); await page.screenshot({ path: p }).catch(() => {}); log('info', `  Screenshot: ${p}`) }
      // DIAGNÓSTICO: listar los inputs visibles del formulario para saber cómo se llama
      // realmente el campo de búsqueda (quizá no contiene "rol").
      await dumpInputsVisibles(page)
      return []
    }
    // LOG DE ÉXITO (antes faltaba): confirma que SÍ escribió el Rol y en qué campo.
    log('info', `  Rol ${numero} escrito en el formulario (${rolOk.campo}).`)
    await sleep(300)

    // PASO 3.5: Escribir el AÑO. El portal necesita número + año para encontrar la causa;
    // buscar solo por número devolvía "no encontrada". El campo de año puede ser un <input>
    // o un <select> (dropdown), así que manejamos ambos. Si no existe el campo, seguimos
    // igual (algunas vistas no lo piden) — no es fatal.
    // Devuelve un código para distinguir los 3 casos y dar un diagnóstico honesto:
    //   'set'        → se escribió el año OK
    //   'no_field'   → no existe campo de año en el formulario (no fatal)
    //   'no_option'  → existe el <select> de año pero NO tiene el año buscado (importante:
    //                  el dropdown quedaría en su default y filtraría por el año equivocado)
    const anioRes = await page.evaluate((anioBuscado: string) => {
      const __name = (x: any) => x  // ver nota sobre esbuild/keepNames arriba
      // Preferimos 'anio'/'año' (formulario en español). 'year' es último recurso y solo
      // si además el elemento parece un campo de año (para no enganchar campos ajenos).
      const matchAnioFuerte = (el: Element) => {
        const name = (el.getAttribute('name') || '').toLowerCase()
        const id = (el.getAttribute('id') || '').toLowerCase()
        const ph = (el.getAttribute('placeholder') || '').toLowerCase()
        return name.includes('anio') || name.includes('año') ||
               id.includes('anio') || id.includes('año') ||
               ph.includes('año') || ph.includes('anio')
      }
      const matchYearDebil = (el: Element) => {
        const name = (el.getAttribute('name') || '').toLowerCase()
        const id = (el.getAttribute('id') || '').toLowerCase()
        return name.includes('year') || id.includes('year')
      }
      // Un <select> "parece de años" si tiene ≥2 opciones que son números de 4 dígitos.
      const pareceSelectDeAnios = (s: HTMLSelectElement) => {
        const opts = Array.from(s.options).map(o => (o.textContent || o.value || '').trim())
        return opts.filter(t => /^\d{4}$/.test(t)).length >= 2
      }
      // Intenta fijar el año en un <select>. Devuelve 'set' si lo puso, 'no_option' si el
      // select no ofrece el año buscado, o null si no debe considerarse.
      const trySelect = (s: HTMLSelectElement): 'set' | 'no_option' | null => {
        const opt = Array.from(s.options).find(o => o.value.trim() === anioBuscado || (o.textContent || '').trim() === anioBuscado)
        if (opt) {
          s.value = opt.value
          s.dispatchEvent(new Event('input', { bubbles: true }))
          s.dispatchEvent(new Event('change', { bubbles: true }))
          return 'set'
        }
        return 'no_option'
      }

      const selects = Array.from(document.querySelectorAll('select')).filter(s => (s as HTMLElement).offsetParent !== null) as HTMLSelectElement[]

      // 1a) PRIMERO: selects con match FUERTE por name/id/placeholder (anio/año). Estos son
      //     inequívocamente el campo de año, así que si alguno tiene el año buscado, lo usamos;
      //     si NINGUNO fuerte lo tiene, reportamos no_option (el año no está disponible).
      const fuertes = selects.filter(matchAnioFuerte)
      if (fuertes.length) {
        for (const s of fuertes) { if (trySelect(s) === 'set') return 'set' }
        return 'no_option'
      }
      // 1b) LUEGO: selects con match débil por 'year' pero que además parezcan de años.
      const debiles = selects.filter(s => matchYearDebil(s) && pareceSelectDeAnios(s))
      if (debiles.length) {
        for (const s of debiles) { if (trySelect(s) === 'set') return 'set' }
        return 'no_option'
      }
      // 1c) ÚLTIMO RECURSO (sin ningún name/id de año): un select que "parezca de años".
      //     Solo lo aceptamos si contiene el año buscado; si no, NO lo tocamos (podría ser
      //     otro filtro) y seguimos buscando un <input>.
      const heuristicos = selects.filter(pareceSelectDeAnios)
      for (const s of heuristicos) { if (trySelect(s) === 'set') return 'set' }
      // 2) <input> de año
      for (const input of Array.from(document.querySelectorAll('input'))) {
        if ((input as HTMLElement).offsetParent === null) continue
        if (!(matchAnioFuerte(input) || matchYearDebil(input))) continue
        ;(input as HTMLInputElement).value = anioBuscado
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return 'set'
      }
      return 'no_field'
    }, año)
    if (anioRes === 'set') {
      log('info', `  Año ${año} escrito en el formulario.`)
    } else if (anioRes === 'no_option') {
      log('warn', `  El selector de "Año" existe pero NO ofrece ${año} → la causa quizá no está en este tribunal/año. Se continúa, pero probablemente no aparezca.`)
    } else {
      log('info', `  (No hay campo "Año" en el formulario; se busca solo por número ${numero}.)`)
    }
    await sleep(300)

    // PASO 6: Click en Buscar (solo el botón VISIBLE del tab Familia)
    // Helper: hace scroll hasta el botón "Buscar" y lo clickea. El scroll importa porque,
    // según prueba en vivo, el portal a veces no renderiza la tabla hasta que el botón
    // (o la zona de resultados) entra en viewport y se vuelve a apretar el filtro.
    const clickBuscar = () => page.evaluate(() => {
      const btns = document.querySelectorAll('button, input[type="submit"], input[type="button"]')
      for (const btn of btns) {
        if ((btn as HTMLElement).offsetParent === null) continue
        const text = (btn.textContent || '').trim()
        const val = (btn as HTMLInputElement).value || ''
        if (text === 'Buscar' || val === 'Buscar') {
          (btn as HTMLElement).scrollIntoView({ block: 'center' })
          ;(btn as HTMLElement).click()
          return true
        }
      }
      return false
    })

    // Helper: RE-ESCRIBE Rol y Año SOLO si quedaron vacíos. Esto hace el reintento robusto
    // aunque el portal recargue/limpie el formulario tras un submit (en ese caso el reclick
    // buscaría con campos vacíos). Es idempotente: si los campos ya tienen valor, no toca nada.
    const reescribirCampos = () => page.evaluate((args: { rol: string; anio: string }) => {
      const __name = (x: any) => x  // ver nota sobre esbuild/keepNames arriba
      const setSiVacio = (el: HTMLInputElement, v: string) => {
        if ((el.value || '').trim() === '') {
          el.value = v
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }
      for (const input of Array.from(document.querySelectorAll('input'))) {
        if ((input as HTMLElement).offsetParent === null) continue
        const name = (input.getAttribute('name') || '').toLowerCase()
        const id = (input.getAttribute('id') || '').toLowerCase()
        const ph = (input.getAttribute('placeholder') || '').toLowerCase()
        if (name.includes('rol') || id.includes('rol') || ph === 'rol') setSiVacio(input as HTMLInputElement, args.rol)
        if (args.anio && (name.includes('anio') || name.includes('año') || id.includes('anio') || id.includes('año') || name.includes('year') || id.includes('year'))) {
          setSiVacio(input as HTMLInputElement, args.anio)
        }
      }
    }, { rol: numero, anio: año })

    // DIAGNÓSTICO (BOT_DIAG_DETALLE=1): volcar los campos DESPUÉS de escribir Rol+Año y
    // ANTES de clickear Buscar, para confirmar QUÉ quedó realmente en cada campo (value=...).
    // Si el Rol quedó vacío aquí, ese es el bug de por qué "no existen causas".
    if (process.env.BOT_DIAG_DETALLE === '1') {
      log('info', '  [DIAG-FORM] Campos del formulario JUSTO ANTES de Buscar (revisar value=):')
      await dumpInputsVisibles(page)
    }

    // PASO 6: primer click en "Buscar".
    await clickBuscar()

    // PASO 7: Esperar resultados con polling (número + año ya escritos → menos filas).
    // CLAVE 1: esperamos a que aparezca una fila cuyo RIT tenga EXACTAMENTE el número
    // buscado (no cualquier RIT), para no cortar el polling sobre resultados residuales
    // de otra búsqueda antes de que renderice la causa correcta.
    // CLAVE 2 (observación en vivo): el portal a veces necesita scrollear y REAPRETAR el
    // filtro para que la tabla aparezca. Por eso, mientras no haya filas, cada ~4.5s
    // hacemos scroll + volvemos a clickear "Buscar". Así reproducimos el gesto humano
    // sin acoplarnos al timing exacto del render.
    const pollTimeout = process.env.BOT_POLL_TIMEOUT ? parseInt(process.env.BOT_POLL_TIMEOUT) * 1000 : 30000
    let resultsFound = false
    const pollStart = Date.now()
    let iter = 0
    while (Date.now() - pollStart < pollTimeout) {
      const hasRows = await page.evaluate((args: { rol: string; anio: string }) => {
        const __name = (x: any) => x  // ver nota sobre esbuild/keepNames arriba
        const rolNum = parseInt(args.rol, 10)
        const tables = Array.from(document.querySelectorAll('table')) as HTMLTableElement[]
        for (const table of tables) {
          // Alinear con la lectura: ignorar tablas de Corte Suprema/Apelaciones
          // (encabezados "Corte" sin "Tribunal"). Así el polling no da "encontrado"
          // por una fila de otra competencia mientras Familia sigue vacía.
          // ⚠️ MISMO criterio que esTablaOtraCompetencia() en readResultsTable — si
          // ajustás uno (ej. agregar "apelaciones"), actualizá el otro en paralelo
          // (son 2 page.evaluate distintos, no comparten closure).
          const ths = Array.from(table.querySelectorAll('th')).map(th => (th.textContent || '').trim().toLowerCase())
          const otraCompetencia = ths.some(t => t.includes('corte')) && !ths.some(t => t.includes('tribunal'))
          if (otraCompetencia) continue
          const trs = table.querySelectorAll('tbody tr, tr')
          for (const tr of trs) {
            const tds = tr.querySelectorAll('td')
            if (tds.length < 4) continue
            const cells = Array.from(tds).map(td => (td.textContent || '').trim())
            for (const cell of cells) {
              // RIT válido cuyo número Y año coincidan con lo buscado (antes solo el
              // número → podía cortar el polling sobre una causa de otro año).
              const m = cell.match(/^[A-Z]{0,3}-?(\d+)-(\d{4})$/)
              if (m && parseInt(m[1], 10) === rolNum && m[2] === args.anio) return true
            }
          }
        }
        return false
      }, { rol: numero, anio: año })
      if (hasRows) { resultsFound = true; break }
      iter++
      // Cada 3 iteraciones (~4.5s) reintentamos: re-escribir campos (por si el portal los
      // limpió) + scroll + click en "Buscar".
      if (iter % 3 === 0) {
        await reescribirCampos().catch(() => {})
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {})
        await sleep(200)
        await clickBuscar()
        log('info', `  (Reintentando filtro: scroll + click en "Buscar"...)`)
      }
      await sleep(1500)
    }

    if (!resultsFound) {
      log('warn', `  Sin resultados para ${ritLegible} (¿causa no visible en este tribunal/año?)`)
      { const p = capturaPath(`bot_error_rit_${tipo}${numero}${año}.png`); await page.screenshot({ path: p }).catch(() => {}); log('info', `  Screenshot: ${p}`) }
      // DIAGNÓSTICO: volcar al log qué está viendo realmente el portal. Esto nos dice si
      // el problema es (a) el campo/botón de búsqueda, (b) que el portal pide más datos,
      // o (c) que el RIT en la tabla tiene un formato que nuestro regex no reconoce.
      await dumpEstadoBusqueda(page, numero)
      return []
    }

    // PASO 8: Leer la tabla. Pasamos número+año+letra para que elija LA TABLA QUE
    // CONTIENE esta causa (no la primera con datos → evita leer Corte Suprema), y
    // para que una colisión de número con otra competencia no seleccione la equivocada.
    const causas = await readResultsTable(page, { numero, año, letra: tipo.toUpperCase() })

    // PASO 9: FILTRAR al RIT EXACTO. CRÍTICO para integridad de datos: el formulario
    // podría no haber filtrado bien (RUT no limpiado, coincidencia por prefijo del Rol,
    // tabla previa sin refrescar) y devolver causas de OTRO expediente. Si abriéramos
    // una fila equivocada, scrapearíamos y guardaríamos datos ajenos bajo este id.
    // Comparamos normalizado (sin espacios, mayúsculas) contra el RIT pedido.
    // El RIT pedido puede venir SIN letra (tipo === ""): "249240-2023". En ese caso NO
    // anteponemos el guion (evita "-249240-2023" que nunca coincidiría). Etiqueta legible:
    const ritPedido = tipo ? `${tipo}-${numero}-${año}` : `${numero}-${año}`
    // Comparación por componentes (letra opcional, número, año) en vez de string literal:
    //   - número y año DEBEN coincidir siempre.
    //   - si el RIT pedido trae letra (tipo), la letra de la fila debe coincidir.
    //   - si el RIT pedido NO trae letra, aceptamos la fila tenga o no letra
    //     (el portal a veces muestra el prefijo aunque busquemos solo por número).
    const partes = (s: string) => {
      const m = s.replace(/\s+/g, '').toUpperCase().match(/^([A-Z]{0,3})-?(\d+)-(\d{4})$/)
      return m ? { letra: m[1], numero: m[2], año: m[3] } : null
    }
    const tipoUp = tipo.toUpperCase()
    // Comparación de número robusta a ceros a la izquierda (el portal podría zero-padear
    // el Rol): comparamos el valor entero, no el string.
    const mismoNumero = (a: string, b: string) => parseInt(a, 10) === parseInt(b, 10)
    const exactas = causas.filter(c => {
      const p = partes(c.rit)
      if (!p) return false
      if (!mismoNumero(p.numero, numero) || p.año !== año) return false
      if (tipoUp && p.letra !== tipoUp) return false
      return true
    })

    if (exactas.length === 0) {
      log('warn', `  La búsqueda de ${ritPedido} no devolvió una coincidencia EXACTA (${causas.length} fila(s) genéricas). Se omite para no scrapear la causa equivocada.`)
      // DIAGNÓSTICO: log de los RIT que SÍ leyó la tabla, para ver por qué ninguno matcheó.
      if (DIAG_ON && causas.length > 0) {
        log('info', `  RIT leídos en la tabla: ${causas.map(c => c.rit).join(' | ')}`)
      }
      await page.screenshot({ path: capturaPath(`bot_error_rit_nomatch_${tipo}${numero}${año}.png`) }).catch(() => {})
      return []
    }
    // FAIL-CLOSED ante ambigüedad de letra: si el usuario buscó SIN letra y el portal
    // devuelve varias causas con el mismo número/año pero DISTINTA letra (P-, F-, ...),
    // no podemos saber cuál es la suya. Adivinar "la primera" arriesga scrapear el
    // expediente equivocado y guardarlo bajo este id. Preferimos omitir la causa.
    const letrasDistintas = new Set(exactas.map(c => partes(c.rit)?.letra || '')).size
    if (exactas.length > 1 && letrasDistintas > 1) {
      log('warn', `  ${exactas.length} causas con número ${numero}-${año} pero distinta letra (${exactas.map(c => c.rit).join(', ')}). Ambiguo: se OMITE para no scrapear la causa equivocada. Especifica la letra del RIT si conoces el tipo.`)
      await page.screenshot({ path: capturaPath(`bot_error_rit_ambiguo_${numero}${año}.png`) }).catch(() => {})
      return []
    }
    if (exactas.length > 1) {
      log('warn', `  ${exactas.length} coincidencias para ${ritPedido} con la misma letra (posible duplicado del portal). Se usa la primera.`)
    }
    log('info', `  → coincidencia exacta para ${exactas[0].rit}`)
    return exactas

  } catch (error: any) {
    log('error', `Error buscando RIT ${rit}: ${error.message}`)
    await page.screenshot({ path: capturaPath(`bot_error_rit_${rit}.png`) }).catch(() => {})
    return []
  }
}

// ============================================================
// DIAGNÓSTICO (solo lectura, no cambia el flujo del bot)
// ============================================================

/**
 * Vuelca al log los inputs y selects VISIBLES del formulario actual. Sirve para
 * descubrir cómo se llama realmente el campo de búsqueda del portal (name/id/placeholder)
 * cuando no encontramos el campo "Rol".
 */
async function dumpInputsVisibles(page: Page): Promise<void> {
  if (!DIAG_ON) return
  try {
    const info = await page.evaluate(() => {
      const __name = (x: any) => x  // ver nota sobre esbuild/keepNames arriba
      const out: string[] = []
      document.querySelectorAll('input, select').forEach((el) => {
        if ((el as HTMLElement).offsetParent === null) return // solo visibles
        const tag = el.tagName.toLowerCase()
        const name = el.getAttribute('name') || ''
        const id = el.getAttribute('id') || ''
        const ph = el.getAttribute('placeholder') || ''
        const type = el.getAttribute('type') || ''
        // VALOR actual: clave para ver si el Rol quedó vacío o si el año quedó puesto.
        // En <select> mostramos la opción seleccionada; en <input> el value.
        let val = ''
        if (tag === 'select') {
          const s = el as HTMLSelectElement
          val = s.options[s.selectedIndex]?.textContent?.trim() || s.value || ''
        } else {
          val = (el as HTMLInputElement).value || ''
        }
        out.push(`${tag}[type=${type}] name="${name}" id="${id}" ph="${ph}" value="${val}"`)
      })
      return out
    })
    log('info', `  [DIAG] Campos visibles del formulario (${info.length}):`)
    info.slice(0, 40).forEach((l) => log('info', `    · ${l}`))
  } catch (e: any) {
    log('warn', `  [DIAG] No se pudieron listar los inputs: ${e.message}`)
  }
}

/**
 * Cuando la búsqueda por RIT no devuelve resultados, vuelca al log el estado real de
 * la página: cuántas tablas hay, sus encabezados, y las primeras filas/celdas. Así
 * sabemos si el portal (a) no mostró tabla (pidió más datos / error), (b) mostró tabla
 * pero con RIT en otro formato, o (c) mostró un mensaje tipo "sin resultados".
 */
async function dumpEstadoBusqueda(page: Page, numeroBuscado: string): Promise<void> {
  try {
    const diag = await page.evaluate(() => {
      const res: any = { url: location.href, tablas: [], mensajes: [] }
      // Mensajes tipo "no se encontraron registros"
      document.querySelectorAll('div, span, p, td').forEach((el) => {
        const t = (el.textContent || '').trim().toLowerCase()
        if (!t) return
        if ((t.includes('no') && (t.includes('registro') || t.includes('resultado') || t.includes('dato'))) ||
            t.includes('sin resultado') || t.includes('no existen')) {
          if (t.length < 120) res.mensajes.push((el.textContent || '').trim())
        }
      })
      document.querySelectorAll('table').forEach((table, ti) => {
        const headers = Array.from(table.querySelectorAll('th')).map(th => (th.textContent || '').trim()).filter(Boolean)
        const filas: string[][] = []
        const trs = table.querySelectorAll('tbody tr, tr')
        let count = 0
        for (const tr of Array.from(trs)) {
          const tds = tr.querySelectorAll('td')
          if (tds.length === 0) continue
          filas.push(Array.from(tds).map(td => (td.textContent || '').trim()))
          if (++count >= 3) break // solo las primeras 3 filas de cada tabla
        }
        res.tablas.push({ idx: ti, headers, filasMuestra: filas })
      })
      return res
    })
    log('info', `  [DIAG] URL actual: ${diag.url}`)
    log('info', `  [DIAG] Tablas encontradas: ${diag.tablas.length}`)
    // El contenido de las tablas (headers, filas) y los mensajes pueden incluir nombres
    // de partes/causas → solo se vuelcan si el diagnóstico detallado está activo (local).
    if (DIAG_ON) {
      if (diag.mensajes.length) {
        const unicos = Array.from(new Set(diag.mensajes)) as string[]
        log('info', `  [DIAG] Mensajes en pantalla: ${unicos.slice(0, 5).join(' || ')}`)
      }
      diag.tablas.forEach((t: any) => {
        log('info', `    · Tabla #${t.idx} headers=[${t.headers.join(', ')}]`)
        t.filasMuestra.forEach((f: string[], i: number) => {
          log('info', `        fila${i}: ${f.join(' | ')}`)
        })
      })
    }
    if (diag.tablas.length === 0) {
      log('warn', `  [DIAG] NO hay ninguna <table> en la página → el portal no mostró resultados (¿pidió más filtros o dio error?). Buscábamos el número ${numeroBuscado}.`)
    }
  } catch (e: any) {
    log('warn', `  [DIAG] No se pudo volcar el estado de la búsqueda: ${e.message}`)
  }
}

// ============================================================
// INTERFACES
// ============================================================
export interface CausaFoundInPortal {
  rit: string
  tribunal: string
  caratulado: string
  fecha_ingreso: string
  estado_procesal: string
  institucion: string
  detailLink?: string
}

// ============================================================
// LEER TABLA DE RESULTADOS
// ------------------------------------------------------------
// IMPORTANTE (fix del bug "lee la tabla equivocada"): el portal de "Mis Causas"
// pinta VARIAS tablas a la vez (una por competencia: Corte Suprema, Apelaciones,
// Civil, ... y Familia). La versión anterior tomaba "la PRIMERA tabla con th
// Rit/Rol que tuviera filas" → como la de Corte Suprema tiene th "Rol" y a veces
// datos residuales, se quedaba con ESA y nunca leía la de Familia (que estaba
// vacía o más abajo). De ahí "No existen causas" aunque la causa sí estaba.
//
// AHORA (Opción B — robusta al reordenamiento de tablas): si conocemos el
// número+año buscado, elegimos LA TABLA QUE CONTIENE la fila de esa causa. Si no
// se puede (o no se pasó target), caemos a la tabla de FAMILIA identificada por
// sus encabezados (Rit + Tribunal, que la de Corte Suprema —Rol + Corte— no
// tiene). Nunca más "la primera tabla con datos".
//
// @param target opcional { numero, año, letra } de la causa buscada (búsqueda por RIT).
//   letra puede ser "" si el RIT se buscó sin prefijo.
// ============================================================
async function readResultsTable(
  page: Page,
  target?: { numero: string; año: string; letra: string },
): Promise<CausaFoundInPortal[]> {
  const causas: CausaFoundInPortal[] = []

  const data = await page.evaluate((target: { numero: string; año: string; letra: string } | null) => {
    const __name = (x: any) => x  // ver nota sobre esbuild/keepNames arriba
    const RIT_RE = /^[A-Z]{0,3}-?\d+-\d{4}$/
    // Captura letra + número + año (la letra puede estar vacía).
    const partesDe = (s: string) => { const m = s.match(/^([A-Z]{0,3})-?(\d+)-(\d{4})$/); return m ? { letra: m[1], n: parseInt(m[2], 10), a: m[3] } : null }

    // ¿Esta tabla es de Corte Suprema/Apelaciones? Esas usan encabezados "Rol" y
    // "Corte" (NO "Rit"/"Tribunal"). Las descartamos de la estrategia por-contenido
    // para que una colisión de número con Familia no nos haga leer la competencia
    // equivocada (bug original: se leía Corte Suprema).
    const esTablaOtraCompetencia = (table: HTMLTableElement) => {
      const ths = Array.from(table.querySelectorAll('th')).map(th => (th.textContent || '').trim().toLowerCase())
      const tieneTribunal = ths.some(t => t.includes('tribunal'))
      const tieneCorte = ths.some(t => t.includes('corte'))
      // Es "otra competencia" si menciona Corte y NO menciona Tribunal (Familia sí lo tiene).
      return tieneCorte && !tieneTribunal
    }

    // Extrae las filas de UNA tabla (celda RIT + columnas siguientes).
    const extraerFilas = (table: HTMLTableElement) => {
      const out: any[] = []
      const trs = table.querySelectorAll('tbody tr, tr')
      for (const tr of trs) {
        const tds = tr.querySelectorAll('td')
        if (tds.length < 4) continue
        const cells = Array.from(tds).map(td => (td.textContent || '').trim())
        const href = tr.querySelector('a[href]')?.getAttribute('href') || null
        let rit = '', startIdx = 0
        for (let i = 0; i < cells.length; i++) {
          if (RIT_RE.test(cells[i])) { rit = cells[i].trim(); startIdx = i; break }
        }
        if (!rit) continue
        out.push({
          rit,
          tribunal: cells[startIdx + 1] || '',
          caratulado: cells[startIdx + 2] || '',
          fecha_ingreso: cells[startIdx + 3] || '',
          estado_procesal: cells[startIdx + 4] || '',
          institucion: cells[startIdx + 5] || '',
          href,
        })
      }
      return out
    }

    const tables = Array.from(document.querySelectorAll('table')) as HTMLTableElement[]

    // 1) PREFERIDO: la tabla que CONTIENE la fila de la causa buscada.
    //    Es lo más robusto: no depende de encabezados ni de la posición de la tabla.
    //    - Coincidencia por número+año Y, si conocemos la letra, TAMBIÉN por letra
    //      (así P-5621-2025 no matchea un 5621-2025 de otra competencia).
    //    - Se saltan las tablas de Corte Suprema/Apelaciones (Rol/Corte) para que una
    //      colisión de número no nos devuelva la competencia equivocada.
    if (target) {
      const nTarget = parseInt(target.numero, 10)
      for (const table of tables) {
        if (esTablaOtraCompetencia(table)) continue
        const filas = extraerFilas(table)
        const contiene = filas.some(f => {
          const d = partesDe(f.rit)
          if (!d || d.n !== nTarget || d.a !== target.año) return false
          // Si buscamos con letra, la fila debe tener esa letra (o venir sin letra:
          // el portal a veces omite el prefijo). Si no buscamos con letra, aceptamos.
          if (target.letra && d.letra && d.letra !== target.letra) return false
          return true
        })
        if (contiene) return filas
      }
    }

    // 2) RESPALDO: la tabla de FAMILIA por encabezados. La de Familia tiene
    //    "Rit" + "Tribunal"; la de Corte Suprema usa "Rol" + "Corte". Exigimos
    //    la combinación para no confundirlas.
    for (const table of tables) {
      const ths = Array.from(table.querySelectorAll('th')).map(th => (th.textContent || '').trim().toLowerCase())
      const tieneRit = ths.some(t => t.includes('rit'))
      const tieneTribunal = ths.some(t => t.includes('tribunal'))
      if (tieneRit && tieneTribunal) {
        const filas = extraerFilas(table)
        if (filas.length > 0) return filas
      }
    }

    // 3) ÚLTIMO RECURSO (compat.): primera tabla con th Rit/Rol y filas.
    //    Se mantiene solo para no romper flujos donde no hay target ni tabla de
    //    Familia identificable; puede leer otra competencia (comportamiento viejo).
    for (const table of tables) {
      const headers = table.querySelectorAll('th')
      let isCorrect = false
      for (const th of headers) {
        const text = (th.textContent || '').trim().toLowerCase()
        if (text.includes('rit') || text.includes('rol')) { isCorrect = true; break }
      }
      if (!isCorrect) continue
      const filas = extraerFilas(table)
      if (filas.length > 0) return filas
    }
    return []
  }, target ?? null)
  
  for (const row of data) {
    causas.push({
      rit: row.rit, tribunal: row.tribunal, caratulado: row.caratulado,
      fecha_ingreso: row.fecha_ingreso, estado_procesal: row.estado_procesal,
      institucion: row.institucion, detailLink: row.href,
    })
  }
  
  // Paginación
  const hasNext = await page.evaluate(() => {
    const links = document.querySelectorAll('a')
    for (const link of links) {
      const text = (link.textContent || '').trim()
      if (text === 'Siguiente' || text === '>' || text === '»') return true
    }
    return false
  })
  
  if (hasNext) {
    log('info', '  Hay más páginas, cargando...')
    let pageNum = 2
    while (pageNum <= 20) {
      const clickedNext = await page.evaluate(() => {
        const links = document.querySelectorAll('a')
        for (const link of links) {
          const text = (link.textContent || '').trim()
          if (text === 'Siguiente' || text === '>' || text === '»') {
            (link as HTMLElement).click()
            return true
          }
        }
        return false
      })
      if (!clickedNext) break
      await sleep(3000)
      
      const moreData = await page.evaluate(() => {
        const rows: any[] = []
        const tables = document.querySelectorAll('table')
        for (const table of tables) {
          const trs = table.querySelectorAll('tbody tr, tr')
          for (const tr of trs) {
            const tds = tr.querySelectorAll('td')
            if (tds.length < 4) continue
            const cells = Array.from(tds).map(td => (td.textContent || '').trim())
            const href = tr.querySelector('a[href]')?.getAttribute('href') || null
            let rit = '', startIdx = 0
            for (let i = 0; i < cells.length; i++) {
              if (cells[i].match(/^[A-Z]{0,3}-?\d+-\d{4}$/)) { rit = cells[i]; startIdx = i; break }
            }
            if (!rit) continue
            rows.push({ rit, tribunal: cells[startIdx+1]||'', caratulado: cells[startIdx+2]||'', fecha_ingreso: cells[startIdx+3]||'', estado_procesal: cells[startIdx+4]||'', institucion: cells[startIdx+5]||'', href })
          }
          if (rows.length > 0) break
        }
        return rows
      })
      
      if (moreData.length === 0) break
      for (const row of moreData) {
        causas.push({ rit: row.rit, tribunal: row.tribunal, caratulado: row.caratulado, fecha_ingreso: row.fecha_ingreso, estado_procesal: row.estado_procesal, institucion: row.institucion, detailLink: row.href })
      }
      pageNum++
    }
  }
  
  return causas
}

// ============================================================
// DETALLE DE CAUSA
// ============================================================
export async function navigateToCausaDetail(page: Page, rit: string): Promise<boolean> {
  try {
    const clicked = await page.evaluate((targetRit: string) => {
      // Compara por COMPONENTES (letra opcional, número, año), no por string literal.
      // Motivo: el RIT objetivo puede venir SIN letra ("249240-2023") mientras el portal
      // muestra la celda CON prefijo ("F-249240-2023"). Un match literal fallaría.
      // Reglas para considerar una fila como la correcta:
      //   - número y año deben coincidir SIEMPRE;
      //   - si el RIT objetivo trae letra, la letra de la fila debe coincidir;
      //   - si el RIT objetivo NO trae letra, se acepta la fila tenga o no letra.
      // Seguimos SIN fallback por substring: solo abrimos ante una coincidencia de
      // número+año (y letra cuando aplica), nunca por coincidencia parcial de dígitos.
      const partes = (s: string) => {
        const m = (s || '').replace(/\s+/g, '').toUpperCase().match(/^([A-Z]{0,3})-?(\d+)-(\d{4})$/)
        return m ? { letra: m[1], numero: m[2], año: m[3] } : null
      }
      const t = partes(targetRit)
      if (!t) return false
      const mismoNumero = (a: string, b: string) => parseInt(a, 10) === parseInt(b, 10)
      const rows = document.querySelectorAll('table tr')
      for (const row of rows) {
        const tds = row.querySelectorAll('td')
        for (const td of tds) {
          const p = partes(td.textContent || '')
          if (!p) continue
          if (!mismoNumero(p.numero, t.numero) || p.año !== t.año) continue
          if (t.letra && p.letra !== t.letra) continue
          const link = row.querySelector('a[href], button, .btn')
          if (link) { (link as HTMLElement).click(); return true }
        }
      }
      return false
    }, rit)
    
    if (clicked) {
      await sleep(4000)
      return true
    }
    return false
  } catch { return false }
}

export async function searchByRIT(page: Page, causa: CausaToScrape): Promise<boolean> {
  return navigateToCausaDetail(page, causa.rit)
}
