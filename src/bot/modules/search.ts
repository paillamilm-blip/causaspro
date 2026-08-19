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
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('a, li, button')
      for (const tab of tabs) {
        const text = (tab.textContent || '').trim()
        if (text === 'Familia') {
          (tab as HTMLElement).click()
          return true
        }
      }
      return false
    })
    
    await sleep(3000)
    log('success', '  En Mis Causas > Familia')
    return true
    
  } catch (error: any) {
    log('error', `Error navegando a Mis Causas: ${error.message}`)
    return false
  }
}

/**
 * Busca causas por año en Mis Causas y retorna la lista de RITs encontrados
 */
export async function searchByYear(page: Page, year: string): Promise<CausaFoundInPortal[]> {
  log('info', `  Buscando causas del año ${year}...`)
  
  try {
    // Llenar campo Año con JavaScript (evita problemas de visibilidad)
    const fillResult = await page.evaluate((y) => {
      // Buscar todos los inputs
      const inputs = document.querySelectorAll('input')
      const results: string[] = []
      
      for (const input of inputs) {
        const name = (input.getAttribute('name') || '').toLowerCase()
        const id = (input.getAttribute('id') || '').toLowerCase()
        const placeholder = (input.getAttribute('placeholder') || '').toLowerCase()
        const value = (input as HTMLInputElement).value
        
        results.push(`input: name=${name} id=${id} ph=${placeholder} val=${value}`)
        
        if (name.includes('ano') || name.includes('año') || id.includes('ano') || 
            id.includes('año') || placeholder.includes('año') || placeholder.includes('ano')) {
          (input as HTMLInputElement).value = y
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return { found: true, method: 'by-name', inputs: results }
        }
      }
      
      // Fallback: buscar input con maxlength=4 o size=4
      for (const input of inputs) {
        const maxLength = input.getAttribute('maxlength')
        const size = input.getAttribute('size')
        if ((maxLength === '4' || size === '4') && !(input as HTMLInputElement).value) {
          (input as HTMLInputElement).value = y
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return { found: true, method: 'by-size', inputs: results }
        }
      }
      
      // Último fallback: el 5to input visible (Rut, Rit-prefix, Rit-dropdown, Rol, AÑO)
      const visibleInputs = Array.from(inputs).filter(i => i.offsetParent !== null && i.type !== 'hidden')
      if (visibleInputs.length >= 5) {
        const yearInput = visibleInputs[4] as HTMLInputElement // 5to campo = Año
        yearInput.value = y
        yearInput.dispatchEvent(new Event('input', { bubbles: true }))
        yearInput.dispatchEvent(new Event('change', { bubbles: true }))
        return { found: true, method: 'by-position-5', inputs: results }
      }
      
      // Si hay al menos 4 campos
      if (visibleInputs.length >= 4) {
        const yearInput = visibleInputs[3] as HTMLInputElement
        yearInput.value = y
        yearInput.dispatchEvent(new Event('input', { bubbles: true }))
        yearInput.dispatchEvent(new Event('change', { bubbles: true }))
        return { found: true, method: 'by-position-4', inputs: results }
      }
      
      return { found: false, method: 'not-found', inputs: results }
    }, year)
    
    log('info', `  Campo Año: ${fillResult?.method || 'unknown'}`)
    if (!fillResult?.found) {
      log('warn', `  Inputs encontrados: ${JSON.stringify(fillResult?.inputs?.slice(0, 5))}`)
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
    
    // DEBUG: ver qué hay en la página
    const pageDebug = await page.evaluate(() => {
      const tables = document.querySelectorAll('table')
      const info: string[] = []
      info.push(`Tables found: ${tables.length}`)
      
      for (let t = 0; t < tables.length; t++) {
        const table = tables[t]
        const rows = table.querySelectorAll('tr')
        const headers = table.querySelectorAll('th')
        const headerTexts = Array.from(headers).map(h => (h.textContent || '').trim()).join(' | ')
        info.push(`Table ${t}: ${rows.length} rows, headers: ${headerTexts}`)
        
        // Primera fila de datos
        if (rows.length > 1) {
          const firstRow = rows[1]
          const cells = firstRow.querySelectorAll('td')
          const cellTexts = Array.from(cells).map(c => (c.textContent || '').trim().substring(0, 30)).join(' | ')
          info.push(`  First row: ${cellTexts}`)
        }
      }
      
      // También buscar si hay mensaje de "no existen causas"
      const body = document.body.textContent || ''
      if (body.includes('No existen')) info.push('PAGE SAYS: No existen causas')
      if (body.includes('no se encontr')) info.push('PAGE SAYS: No se encontraron')
      
      return info
    })
    
    for (const line of pageDebug) {
      log('info', `  DEBUG: ${line}`)
    }
    
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
      // Verificar que es la tabla correcta (tiene columna Rit)
      let isCorrect = false
      for (const th of headers) {
        if ((th.textContent || '').trim().toLowerCase().includes('rit')) {
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
          // Buscar celda que parezca RIT (formato X-123-2026)
          if (cells[i].match(/[A-Z]-\d+-\d{4}/)) {
            rit = cells[i]
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
