// ============================================================
// CAUSASPRO BOT - Search Module (via Mis Causas > Familia)
// ULTRA REVIEW FIX: 9 bugs corregidos
// ============================================================

import type { Page } from 'playwright'
import type { CausaToScrape } from '../types'
import { sleep, log } from '../utils'

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
      await page.screenshot({ path: '/tmp/bot_error_familia_fail.png' }).catch(() => {})
      log('info', '  Screenshot guardado: /tmp/bot_error_familia_fail.png')
    }
    
    return true
    
  } catch (error: any) {
    log('error', `Error navegando a Mis Causas: ${error.message}`)
    return false
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
    await page.evaluate(() => {
      const toggles = document.querySelectorAll('input[type="checkbox"], .custom-switch input, [role="switch"]')
      for (const toggle of toggles) {
        if ((toggle as HTMLElement).offsetParent === null) continue
        const parent = toggle.closest('.custom-switch, .form-check, label, div')
        const parentText = parent ? (parent.textContent || '') : ''
        if (parentText.includes('Filtro') || parentText.includes('filtro')) {
          if (!(toggle as HTMLInputElement).checked) {
            (toggle as HTMLElement).click()
          }
          return
        }
      }
    })
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
      await page.screenshot({ path: `/tmp/bot_error_buscar_${year}.png` }).catch(() => {})
      log('info', `  Screenshot guardado: /tmp/bot_error_buscar_${year}.png`)
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
    await page.screenshot({ path: `/tmp/bot_error_search_${year}.png` }).catch(() => {})
    return []
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
// ============================================================
async function readResultsTable(page: Page): Promise<CausaFoundInPortal[]> {
  const causas: CausaFoundInPortal[] = []
  
  const data = await page.evaluate(() => {
    const rows: any[] = []
    const tables = document.querySelectorAll('table')
    
    for (const table of tables) {
      const headers = table.querySelectorAll('th')
      let isCorrect = false
      for (const th of headers) {
        const text = (th.textContent || '').trim().toLowerCase()
        if (text.includes('rit') || text.includes('rol')) {
          isCorrect = true
          break
        }
      }
      if (!isCorrect) continue
      
      const trs = table.querySelectorAll('tbody tr, tr')
      for (const tr of trs) {
        const tds = tr.querySelectorAll('td')
        if (tds.length < 4) continue
        
        const cells = Array.from(tds).map(td => (td.textContent || '').trim())
        const detailLink = tr.querySelector('a[href]')
        const href = detailLink ? detailLink.getAttribute('href') : null
        
        // Buscar celda RIT — ESTRICTO: requiere formato con letra O número-año
        let rit = ''
        let startIdx = 0
        
        for (let i = 0; i < cells.length; i++) {
          // Match: C-4875-2025, P-7940-2026, F-3069-2026, FA-123-2024, X-4187-2026, 44977-2026
          if (cells[i].match(/^[A-Z]{0,3}-?\d+-\d{4}$/)) {
            rit = cells[i].trim()
            startIdx = i
            break
          }
        }
        
        if (!rit) continue
        
        rows.push({
          rit,
          tribunal: cells[startIdx + 1] || '',
          caratulado: cells[startIdx + 2] || '',
          fecha_ingreso: cells[startIdx + 3] || '',
          estado_procesal: cells[startIdx + 4] || '',
          institucion: cells[startIdx + 5] || '',
          href,
        })
      }
      
      if (rows.length > 0) break
    }
    return rows
  })
  
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
      const rows = document.querySelectorAll('table tr')
      for (const row of rows) {
        if ((row.textContent || '').includes(targetRit)) {
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
