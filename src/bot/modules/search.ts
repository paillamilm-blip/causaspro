// ============================================================
// CAUSASPRO BOT - Search Module (via Mis Causas)
// Lee todas las causas desde "Mis Causas" filtrando por año
// NO usa Consulta Causas (tiene CAPTCHA)
// ============================================================

import type { Page } from 'playwright'
import type { CausaToScrape } from '../types'
import { sleep, log } from '../utils'

/**
 * Navega a "Mis Causas" > Tab Familia > Filtra por año > Lee tabla
 */
export async function navigateToConsulta(page: Page): Promise<boolean> {
  log('info', 'Navegando a Mis Causas...')
  
  try {
    // Click en "Mis Causas" del menú izquierdo
    const clicked = await page.evaluate(() => {
      const links = document.querySelectorAll('a')
      for (const link of links) {
        const text = (link.textContent || '').trim()
        if (text === 'Mis Causas' || text === 'Mis causas') {
          link.click()
          return true
        }
      }
      return false
    })
    
    if (!clicked) {
      // Navegar directo
      await page.goto('https://oficinajudicialvirtual.pjud.cl/indexN.php', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
    }
    
    await sleep(4000)
    
    // Click en tab "Familia"
    log('info', '  Seleccionando tab Familia...')
    
    const familiaClicked = await page.evaluate(() => {
      // Los tabs están en una fila horizontal con textos:
      // Corte Suprema | Corte Apelaciones | Civil | Laboral | Penal | Cobranza | Familia | Disciplinario
      
      // Buscar TODOS los links con texto "Familia"
      const allLinks = Array.from(document.querySelectorAll('a'))
      const familiaLinks = allLinks.filter(a => (a.textContent || '').trim() === 'Familia')
      
      if (familiaLinks.length === 0) return null
      
      // Si hay varios, necesitamos el que está en la barra de tabs (no el del menú lateral)
      // El del tab generalmente está cerca de los otros tabs (Corte Suprema, Civil, etc.)
      for (const link of familiaLinks) {
        const parent = link.parentElement?.parentElement || link.parentElement
        const siblings = parent?.textContent || ''
        // Si el contenedor tiene otros nombres de tabs, es la barra correcta
        if (siblings.includes('Corte Suprema') || siblings.includes('Civil') || siblings.includes('Laboral')) {
          link.click()
          return 'clicked-tab-bar'
        }
      }
      
      // Si no encontramos por contexto, clickear el ÚLTIMO (generalmente el de la barra, no el menú)
      familiaLinks[familiaLinks.length - 1].click()
      return 'clicked-last-familia'
    })
    
    log('info', `  Tab Familia: ${familiaClicked || 'NO encontrado'}`)
    
    // Esperar a que la tabla se actualice con datos de Familia
    // (el contenido cambia dinámicamente después del click)
    await sleep(3000)
    
    // Esperar hasta que aparezca "Juzgado de Familia" en la tabla o max 15 segundos
    for (let i = 0; i < 5; i++) {
      const hasFamily = await page.evaluate(() => {
        const body = document.body.textContent || ''
        return body.includes('Juzgado de Familia') || body.includes('Familia Santiago') || body.includes('Familia San Miguel')
      })
      if (hasFamily) {
        log('info', '  ✓ Tabla de Familia cargada')
        break
      }
      await sleep(3000)
    }
    
    log('success', '  En Mis Causas > Familia')
    return true
    
  } catch (error: any) {
    log('error', `Error navegando a Mis Causas: ${error.message}`)
    return false
  }
}

/**
 * Busca causas - activa filtros, selecciona todos los tipos y estados, busca por año
 */
export async function searchByYear(page: Page, year: string): Promise<CausaFoundInPortal[]> {
  log('info', `  Buscando causas del año ${year}...`)
  
  try {
    // PASO 1: Activar toggle de Filtros (si está apagado)
    log('info', '  Activando filtros...')
    await page.evaluate(() => {
      // Buscar toggle/switch de filtros
      const toggles = document.querySelectorAll('input[type="checkbox"], .custom-switch input, .toggle-switch input, [role="switch"]')
      for (const toggle of toggles) {
        const parent = toggle.closest('.custom-switch, .form-check, label, div')
        const parentText = parent ? (parent.textContent || '') : ''
        if (parentText.includes('Filtro') || parentText.includes('filtro')) {
          if (!(toggle as HTMLInputElement).checked) {
            (toggle as HTMLElement).click()
          }
          return 'toggled-by-text'
        }
      }
      // Fallback: click en el primer toggle/switch visible
      const firstToggle = document.querySelector('.custom-control-input, input[type="checkbox"][role="switch"], .form-switch input') as HTMLElement
      if (firstToggle) {
        firstToggle.click()
        return 'toggled-first'
      }
      return null
    })
    
    await sleep(2000)
    
    // PASO 2: Seleccionar TODOS los Tipos de Causa (5 de 5)
    log('info', '  Seleccionando Tipo Causa (5 de 5)...')
    await page.evaluate(() => {
      // Buscar el select/multiselect de Tipo Causa
      const selects = document.querySelectorAll('select')
      for (const select of selects) {
        const label = select.closest('div, td')?.textContent || ''
        const name = (select.getAttribute('name') || '').toLowerCase()
        if (label.includes('Tipo') || name.includes('tipo')) {
          // Seleccionar TODAS las opciones
          const options = select.querySelectorAll('option')
          options.forEach(opt => (opt as HTMLOptionElement).selected = true)
          select.dispatchEvent(new Event('change', { bubbles: true }))
          return 'selected-all-tipo'
        }
      }
      // Fallback: buscar checkboxes de tipo
      const checkboxes = document.querySelectorAll('input[type="checkbox"]')
      checkboxes.forEach(cb => {
        const parent = cb.closest('label, div, li')
        const text = parent ? (parent.textContent || '') : ''
        if (text.includes('Protección') || text.includes('Voluntario') || text.includes('Contencioso')) {
          (cb as HTMLInputElement).checked = true
          cb.dispatchEvent(new Event('change', { bubbles: true }))
        }
      })
      return null
    })
    
    await sleep(1000)
    
    // PASO 3: Seleccionar TODOS los Estados (12 de 12)
    log('info', '  Seleccionando Estado (12 de 12)...')
    await page.evaluate(() => {
      const selects = document.querySelectorAll('select')
      for (const select of selects) {
        const label = select.closest('div, td')?.textContent || ''
        const name = (select.getAttribute('name') || '').toLowerCase()
        if (label.includes('Estado') || name.includes('estado')) {
          const options = select.querySelectorAll('option')
          options.forEach(opt => (opt as HTMLOptionElement).selected = true)
          select.dispatchEvent(new Event('change', { bubbles: true }))
          return 'selected-all-estado'
        }
      }
      return null
    })
    
    await sleep(1000)
    
    // PASO 4: Llenar campo Año
    log('info', `  Año: ${year}...`)
    await page.evaluate((y) => {
      const inputs = document.querySelectorAll('input')
      for (const input of inputs) {
        const name = (input.getAttribute('name') || '').toLowerCase()
        const id = (input.getAttribute('id') || '').toLowerCase()
        const placeholder = (input.getAttribute('placeholder') || '').toLowerCase()
        
        if (name.includes('ano') || name.includes('año') || id.includes('ano') || 
            id.includes('año') || placeholder.includes('año') || placeholder.includes('ano')) {
          (input as HTMLInputElement).value = y
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        }
      }
      // Fallback por posición
      const visibleInputs = Array.from(inputs).filter(i => i.offsetParent !== null && i.type !== 'hidden')
      if (visibleInputs.length >= 5) {
        (visibleInputs[4] as HTMLInputElement).value = y
        visibleInputs[4].dispatchEvent(new Event('input', { bubbles: true }))
        visibleInputs[4].dispatchEvent(new Event('change', { bubbles: true }))
      }
      return false
    }, year)
    
    await sleep(1000)
    
    // PASO 5: Click en Buscar
    log('info', '  Click en Buscar...')
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn')
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim()
        const value = (btn as HTMLInputElement).value || ''
        if (text === 'Buscar' || value === 'Buscar' || text.includes('Buscar')) {
          (btn as HTMLElement).click()
          return true
        }
      }
      const form = document.querySelector('form')
      if (form) { form.submit(); return true }
      return false
    })
    
    await sleep(5000)
    
    // PASO 6: RE-SELECCIONAR TAB FAMILIA después de buscar
    // (El portal resetea el tab al enviar la búsqueda)
    log('info', '  Re-seleccionando Familia post-búsqueda...')
    await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a'))
      const familiaLinks = allLinks.filter(a => (a.textContent || '').trim() === 'Familia')
      for (const link of familiaLinks) {
        const parent = link.parentElement?.parentElement || link.parentElement
        const siblings = parent?.textContent || ''
        if (siblings.includes('Corte Suprema') || siblings.includes('Civil') || siblings.includes('Laboral')) {
          link.click()
          return
        }
      }
      if (familiaLinks.length > 0) familiaLinks[familiaLinks.length - 1].click()
    })
    
    // Esperar a que Familia cargue — verificar en la TABLA específicamente
    for (let i = 0; i < 8; i++) {
      await sleep(2000)
      const hasFam = await page.evaluate(() => {
        const tables = document.querySelectorAll('table')
        for (const t of tables) {
          const text = t.textContent || ''
          if (text.includes('Juzgado de Familia') || text.includes('Familia San') || 
              text.includes('Familia Santiago') || text.includes('Medidas Cautelares')) return true
        }
        return false
      })
      if (hasFam) {
        log('info', '  ✓ Tabla Familia confirmada post-búsqueda')
        break
      }
    }
    
    // Leer resultados
    const causas = await readResultsTable(page)
    
    // PASO 7: FILTRAR — solo causas de Familia
    // Log para debug: mostrar qué tribunal tienen
    if (causas.length > 0) {
      log('info', `  Datos leídos: ${causas.map(c => `${c.rit} [${c.tribunal}]`).join(', ')}`)
    }
    
    const causasFamilia = causas.filter(c => {
      const trib = c.tribunal.toLowerCase()
      const isFamilia = trib.includes('familia') || 
                        trib.includes('medida') || // Centro de Medidas Cautelares (familia)
                        /^[PCFX]-\d+-\d{4}$/.test(c.rit) // RIT con letra = Familia
      return isFamilia
    })
    
    if (causasFamilia.length < causas.length) {
      log('info', `  Filtrado: ${causas.length} total → ${causasFamilia.length} de Familia`)
    }
    
    log('info', `  → ${causasFamilia.length} causas de FAMILIA para ${year}`)
    
    return causasFamilia
    
  } catch (error: any) {
    log('error', `Error buscando año ${year}: ${error.message}`)
    return []
  }
}

export interface CausaFoundInPortal {
  rit: string
  tribunal: string
  caratulado: string
  fecha_ingreso: string
  estado_procesal: string
  institucion: string
  detailLink?: string // URL o selector para ver detalle
}

/**
 * Lee la tabla de resultados de Mis Causas
 */
async function readResultsTable(page: Page): Promise<CausaFoundInPortal[]> {
  const causas: CausaFoundInPortal[] = []
  
  const data = await page.evaluate(() => {
    const rows: any[] = []
    // Buscar la tabla de resultados
    const tables = document.querySelectorAll('table')
    
    for (const table of tables) {
      const headers = table.querySelectorAll('th')
      // Verificar que es la tabla correcta (tiene columna Rit o Rol)
      let isCorrect = false
      for (const th of headers) {
        const text = (th.textContent || '').trim().toLowerCase()
        if (text.includes('rit') || text.includes('rol') || text.includes('causa')) {
          isCorrect = true
          break
        }
      }
      
      if (!isCorrect) continue
      
      // Leer filas
      const trs = table.querySelectorAll('tbody tr, tr')
      for (const tr of trs) {
        const tds = tr.querySelectorAll('td')
        if (tds.length < 4) continue
        
        const cells = Array.from(tds).map(td => (td.textContent || '').trim())
        
        // Buscar link de detalle (lupa)
        const detailLink = tr.querySelector('a[href]')
        const href = detailLink ? detailLink.getAttribute('href') : null
        
        // La primera celda puede tener un ícono de lupa + RIT
        let rit = ''
        let startIdx = 0
        
        for (let i = 0; i < cells.length; i++) {
          // Buscar celda que parezca RIT/ROL (formato X-123-2026 o 12345-2026)
          if (cells[i].match(/[A-Z]?-?\d+-\d{4}/)) {
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
      
      if (rows.length > 0) break // Ya encontramos la tabla correcta
    }
    
    return rows
  })
  
  for (const row of data) {
    causas.push({
      rit: row.rit,
      tribunal: row.tribunal,
      caratulado: row.caratulado,
      fecha_ingreso: row.fecha_ingreso,
      estado_procesal: row.estado_procesal,
      institucion: row.institucion,
      detailLink: row.href,
    })
  }
  
  // Verificar si hay paginación
  const hasNextPage = await page.evaluate(() => {
    const links = document.querySelectorAll('a')
    for (const link of links) {
      const text = (link.textContent || '').trim()
      if (text === 'Siguiente' || text === '>' || text === '»' || text === 'Next') {
        return true
      }
    }
    return false
  })
  
  if (hasNextPage) {
    log('info', '  Hay más páginas, cargando...')
    // Click siguiente y leer más
    let pageNum = 2
    while (pageNum <= 20) { // Máximo 20 páginas
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
            const detailLink = tr.querySelector('a[href]')
            const href = detailLink ? detailLink.getAttribute('href') : null
            let rit = ''
            let startIdx = 0
            for (let i = 0; i < cells.length; i++) {
              if (cells[i].match(/[A-Z]?-?\d+-\d{4}/)) { rit = cells[i]; startIdx = i; break }
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
        causas.push({
          rit: row.rit, tribunal: row.tribunal, caratulado: row.caratulado,
          fecha_ingreso: row.fecha_ingreso, estado_procesal: row.estado_procesal,
          institucion: row.institucion, detailLink: row.href,
        })
      }
      
      pageNum++
    }
  }
  
  return causas
}

/**
 * Click en la lupa de una causa para ver su detalle
 */
export async function navigateToCausaDetail(page: Page, rit: string): Promise<boolean> {
  try {
    // Buscar la fila con el RIT y hacer click en la lupa
    const clicked = await page.evaluate((targetRit) => {
      const rows = document.querySelectorAll('table tr')
      for (const row of rows) {
        const text = row.textContent || ''
        if (text.includes(targetRit)) {
          const link = row.querySelector('a[href], button, .btn')
          if (link) {
            (link as HTMLElement).click()
            return true
          }
        }
      }
      return false
    }, rit)
    
    if (clicked) {
      await sleep(4000)
      log('info', `  Detalle de ${rit} abierto`)
      return true
    }
    
    return false
  } catch {
    return false
  }
}

/**
 * Buscar por RIT específico (para compatibilidad con orchestrator)
 */
export async function searchByRIT(page: Page, causa: CausaToScrape): Promise<boolean> {
  // En el nuevo flujo, las causas ya están listadas en la tabla
  // Solo necesitamos hacer click en la lupa de la causa correcta
  return navigateToCausaDetail(page, causa.rit)
}
