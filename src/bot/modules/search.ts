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
    
    // Click en tab "Familia" — es el 7mo tab de la lista
    log('info', '  Seleccionando tab Familia...')
    
    const familiaClicked = await page.evaluate(() => {
      // Los tabs son links dentro de una barra de navegación
      // Orden: Corte Suprema | Corte Apelaciones | Civil | Laboral | Penal | Cobranza | Familia | Disciplinario
      
      // Método 1: Buscar link con texto exacto "Familia"
      const allLinks = document.querySelectorAll('a')
      for (const link of allLinks) {
        const text = (link.textContent || '').trim()
        if (text === 'Familia') {
          link.click()
          return 'clicked-by-text-exact'
        }
      }
      
      // Método 2: Buscar en la barra de tabs (los que parecen tabs)
      const tabBar = document.querySelector('ul.nav, .nav-tabs, .tabs')
      if (tabBar) {
        const tabs = tabBar.querySelectorAll('li a, a')
        for (const tab of tabs) {
          if ((tab.textContent || '').trim() === 'Familia') {
            (tab as HTMLElement).click()
            return 'clicked-in-navbar'
          }
        }
      }
      
      return null
    })
    
    log('info', `  Tab Familia: ${familiaClicked || 'NO encontrado'}`)
    
    // Esperar a que cargue la pestaña Familia
    await sleep(5000)
    
    // Verificar que estamos en Familia (buscar texto "Juzgado de Familia" en la página)
    const inFamilia = await page.evaluate(() => {
      const body = document.body.textContent || ''
      return body.includes('Familia') && (body.includes('Juzgado') || body.includes('Rit'))
    })
    
    if (!inFamilia) {
      log('warn', '  No se confirmó tab Familia, intentando de nuevo...')
      // Segundo intento: click por posición en la barra de tabs
      await page.evaluate(() => {
        const links = document.querySelectorAll('a')
        const familiaLinks = Array.from(links).filter(l => (l.textContent || '').trim() === 'Familia')
        if (familiaLinks.length > 0) {
          // El último match suele ser el correcto (el de la barra principal, no del menú lateral)
          familiaLinks[familiaLinks.length - 1].click()
        }
      })
      await sleep(4000)
    }
    
    log('success', '  En Mis Causas > Familia')
    log('success', '  En Mis Causas > Familia')
    return true
    
  } catch (error: any) {
    log('error', `Error navegando a Mis Causas: ${error.message}`)
    return false
  }
}

/**
 * Busca causas - primero intenta leer sin filtros, si no hay datos activa filtros por año
 */
export async function searchByYear(page: Page, year: string): Promise<CausaFoundInPortal[]> {
  log('info', `  Buscando causas del año ${year}...`)
  
  try {
    // Verificar si ya hay datos en la tabla (filtros OFF = muestra todo)
    const directData = await readResultsTable(page)
    if (directData.length > 0 && year === '2026') {
      // Ya hay datos visibles sin filtrar — usarlos directamente
      log('info', `  → ${directData.length} causas ya visibles (sin filtro)`)
      return directData
    }
    
    // Si no hay datos o es otro año, activar filtros
    // Activar toggle de filtros si está apagado
    await page.evaluate(() => {
      const toggle = document.querySelector('input[type="checkbox"], .toggle, [role="switch"]') as HTMLInputElement
      if (toggle && !toggle.checked) {
        toggle.click()
      }
      // También buscar por clase de toggle
      const toggleDiv = document.querySelector('.custom-control-input, .form-check-input')
      if (toggleDiv) (toggleDiv as HTMLElement).click()
    })
    
    await sleep(2000)
    
    // Llenar campo Año con JavaScript
    const fillResult = await page.evaluate((y) => {
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
          return { found: true, method: 'by-name' }
        }
      }
      
      // Fallback por posición
      const visibleInputs = Array.from(inputs).filter(i => i.offsetParent !== null && i.type !== 'hidden')
      if (visibleInputs.length >= 5) {
        const yearInput = visibleInputs[4] as HTMLInputElement
        yearInput.value = y
        yearInput.dispatchEvent(new Event('input', { bubbles: true }))
        yearInput.dispatchEvent(new Event('change', { bubbles: true }))
        return { found: true, method: 'by-position' }
      }
      
      return { found: false, method: 'not-found' }
    }, year)
    
    log('info', `  Campo Año: ${fillResult?.method || 'unknown'}`)
    await sleep(1000)
    
    // Click en Buscar
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
    
    // Leer resultados
    const causas = await readResultsTable(page)
    log('info', `  → ${causas.length} causas encontradas para ${year}`)
    
    return causas
    
  } catch (error: any) {
    log('error', `Error buscando año ${year}: ${error.message}`)
    return []
  }
}
    
    await sleep(1000)
    
    // Click en Buscar con JavaScript
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
      // Fallback: submit form
      const form = document.querySelector('form')
      if (form) { form.submit(); return true }
      return false
    })
    
    await sleep(5000)
    
    // Leer la tabla de resultados
    const causas = await readResultsTable(page)
    log('info', `  → ${causas.length} causas encontradas para ${year}`)
    
    return causas
    
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
              if (cells[i].match(/[A-Z]-\d+-\d{4}/)) { rit = cells[i]; startIdx = i; break }
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
