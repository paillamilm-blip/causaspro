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
    // Limpiar campo Rol y Rit (dejar vacíos)
    await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"], input[type="number"]')
      inputs.forEach(input => {
        const name = input.getAttribute('name') || ''
        const id = input.getAttribute('id') || ''
        // Limpiar Rol y Rit pero NO el Rut
        if (name.toLowerCase().includes('rol') || id.toLowerCase().includes('rol') ||
            name.toLowerCase().includes('rit') || id.toLowerCase().includes('rit')) {
          // No limpiar si es el campo de número de RIT tipo "9"
        }
      })
    })
    
    // Poner el año
    const yearInput = await page.$('input[name*="ano"], input[name*="año"], input[id*="ano"], input[placeholder*="Año"]')
    if (yearInput) {
      await yearInput.fill('')
      await sleep(300)
      await yearInput.fill(year)
    } else {
      // Buscar por posición (el campo Año está después de Rol)
      await page.evaluate((y) => {
        const inputs = document.querySelectorAll('input[type="text"], input[type="number"]')
        // El campo Año generalmente es el 4to o 5to input
        for (const input of inputs) {
          const placeholder = input.getAttribute('placeholder') || ''
          const name = input.getAttribute('name') || ''
          if (placeholder.includes('Año') || placeholder.includes('año') || name.includes('ano')) {
            (input as HTMLInputElement).value = y
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.dispatchEvent(new Event('change', { bubbles: true }))
            return
          }
        }
        // Fallback: buscar input cerca de texto "Año"
        const labels = document.querySelectorAll('label, span, td, th')
        for (const label of labels) {
          if ((label.textContent || '').includes('Año')) {
            const input = label.parentElement?.querySelector('input') || 
                          label.nextElementSibling as HTMLInputElement
            if (input && input.tagName === 'INPUT') {
              (input as HTMLInputElement).value = y
              input.dispatchEvent(new Event('input', { bubbles: true }))
              input.dispatchEvent(new Event('change', { bubbles: true }))
              return
            }
          }
        }
      }, year)
    }
    
    await sleep(1000)
    
    // Click en Buscar
    log('info', '  Click en Buscar...')
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, input[type="submit"], a')
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim()
        const value = btn.getAttribute('value') || ''
        if (text === 'Buscar' || value === 'Buscar') {
          (btn as HTMLElement).click()
          return true
        }
      }
      // Fallback: submit del form
      const form = document.querySelector('form')
      if (form) form.submit()
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
    const paginators = document.querySelectorAll('a:has-text("Siguiente"), a:has-text(">"), .pagination .next a, a[aria-label="Next"]')
    return paginators.length > 0
  })
  
  if (hasNextPage) {
    log('info', '  Hay más páginas, cargando...')
    // Click siguiente y leer más
    let pageNum = 2
    while (pageNum <= 20) { // Máximo 20 páginas
      const clickedNext = await page.evaluate(() => {
        const next = document.querySelector('a:has-text("Siguiente"), a:has-text(">"), .pagination .next a') as HTMLElement
        if (next) { next.click(); return true }
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
