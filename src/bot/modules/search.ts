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
      await page.goto('https://oficinajudicialvirtual.pjud.cl/indexN.php', {
        waitUntil: 'domcontentloaded', timeout: 60000,
      })
    }
    
    await sleep(5000)
    
    // Click en tab Familia — usar ID directo: #familiaTab
    log('info', '  Seleccionando tab Familia (#familiaTab)...')
    
    try {
      // Usar Playwright click real (no JS) — el portal necesita el evento nativo
      await page.click('#familiaTab', { timeout: 10000, force: true })
      log('info', '  ✓ Click en #familiaTab realizado')
    } catch {
      // Fallback: navegar a la URL
      log('warn', '  #familiaTab no clickeable, navegando a URL...')
      await page.goto('https://oficinajudicialvirtual.pjud.cl/indexN.php#tab7', {
        waitUntil: 'domcontentloaded', timeout: 60000,
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
      await page.screenshot({ path: 'screenshot-familia-fail.png' }).catch(() => {})
      log('info', '  Screenshot guardado: screenshot-familia-fail.png')
    }
    
    return true
    
  } catch (error: any) {
    log('error', `Error navegando a Mis Causas: ${error.message}`)
    return false
  }
}

// ============================================================
// BUSCAR POR AÑO
// ============================================================
export async function searchByYear(page: Page, year: string): Promise<CausaFoundInPortal[]> {
  log('info', `  Buscando causas del año ${year}...`)
  
  try {
    // PASO 1: Activar Filtros
    log('info', '  Activando filtros...')
    await page.evaluate(() => {
      const toggles = document.querySelectorAll('input[type="checkbox"], .custom-switch input, [role="switch"]')
      for (const toggle of toggles) {
        const parent = toggle.closest('.custom-switch, .form-check, label, div')
        const parentText = parent ? (parent.textContent || '') : ''
        if (parentText.includes('Filtro') || parentText.includes('filtro')) {
          if (!(toggle as HTMLInputElement).checked) {
            (toggle as HTMLElement).click()
          }
          return
        }
      }
      // Fallback
      const first = document.querySelector('.custom-control-input, input[role="switch"]') as HTMLElement
      if (first) first.click()
    })
    await sleep(2000)
    
    // PASO 2: Tipo Causa = todos (5/5)
    log('info', '  Seleccionando Tipo Causa (5 de 5)...')
    await page.evaluate(() => {
      const selects = document.querySelectorAll('select')
      for (const select of selects) {
        const nearText = (select.closest('div, td')?.textContent || '').toLowerCase()
        const name = (select.getAttribute('name') || '').toLowerCase()
        if (nearText.includes('tipo') || name.includes('tipo')) {
          select.querySelectorAll('option').forEach(opt => (opt as HTMLOptionElement).selected = true)
          select.dispatchEvent(new Event('change', { bubbles: true }))
          // Trigger jQuery si existe
          try { (window as any).$(select).trigger('change') } catch {}
          return
        }
      }
    })
    await sleep(1000)
    
    // PASO 3: Estado = todos (12/12)
    log('info', '  Seleccionando Estado (12 de 12)...')
    await page.evaluate(() => {
      const selects = document.querySelectorAll('select')
      for (const select of selects) {
        const nearText = (select.closest('div, td')?.textContent || '').toLowerCase()
        const name = (select.getAttribute('name') || '').toLowerCase()
        if (nearText.includes('estado') || name.includes('estado')) {
          select.querySelectorAll('option').forEach(opt => (opt as HTMLOptionElement).selected = true)
          select.dispatchEvent(new Event('change', { bubbles: true }))
          try { (window as any).$(select).trigger('change') } catch {}
          return
        }
      }
    })
    await sleep(1000)
    
    // PASO 4: Año
    log('info', `  Año: ${year}...`)
    await page.evaluate((y) => {
      const inputs = document.querySelectorAll('input')
      for (const input of inputs) {
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
      // Fallback posición
      const visible = Array.from(inputs).filter(i => i.offsetParent !== null && i.type !== 'hidden')
      if (visible.length >= 5) {
        (visible[4] as HTMLInputElement).value = y
        visible[4].dispatchEvent(new Event('input', { bubbles: true }))
      }
    }, year)
    await sleep(1000)
    
    // PASO 5: Click Buscar
    log('info', '  Click en Buscar...')
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn')
      for (const btn of btns) {
        const text = (btn.textContent || '').trim()
        const val = (btn as HTMLInputElement).value || ''
        if (text === 'Buscar' || val === 'Buscar') {
          (btn as HTMLElement).click()
          return
        }
      }
    })
    await sleep(5000)
    
    // PASO 6: RE-SELECCIONAR FAMILIA (el portal resetea el tab)
    log('info', '  Re-seleccionando Familia post-búsqueda...')
    try {
      await page.click('#familiaTab', { timeout: 10000, force: true })
    } catch {
      await page.goto('https://oficinajudicialvirtual.pjud.cl/indexN.php#tab7', {
        waitUntil: 'domcontentloaded', timeout: 60000,
      })
    }
    await sleep(3000)
    
    // Verificar que Familia cargó
    const verified = await verifyFamiliaTab(page, 16000)
    if (verified) {
      log('info', '  ✓ Tabla Familia confirmada post-búsqueda')
    } else {
      log('warn', '  ⚠️ No se confirmó Familia post-búsqueda — leyendo de todos modos')
    }
    
    // PASO 7: Leer tabla
    const causas = await readResultsTable(page)
    
    // PASO 8: FILTRO ESTRICTO — solo Familia
    if (causas.length > 0) {
      log('info', `  Datos: ${causas.slice(0, 3).map(c => `${c.rit}[${c.tribunal.substring(0,20)}]`).join(', ')}`)
    }
    
    const causasFamilia = causas.filter(c => {
      // Aceptar si tribunal menciona "Familia" o "Medidas Cautelares"
      const trib = c.tribunal.toLowerCase()
      if (trib.includes('familia') || trib.includes('medida')) return true
      // Aceptar si RIT tiene letra prefix (C-xxxx, P-xxxx, F-xxxx, X-xxxx)
      if (/^[A-Z]-\d+-\d{4}$/.test(c.rit)) return true
      // Rechazar todo lo demás (Corte Suprema, etc)
      return false
    })
    
    if (causasFamilia.length < causas.length) {
      log('info', `  Filtrado: ${causas.length} → ${causasFamilia.length} de Familia`)
    }
    
    log('info', `  → ${causasFamilia.length} causas de FAMILIA para ${year}`)
    return causasFamilia
    
  } catch (error: any) {
    log('error', `Error buscando año ${year}: ${error.message}`)
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
          // Match: C-4875-2025, P-7940-2026, F-3069-2026, X-4187-2026, 44977-2026
          if (cells[i].match(/^[A-Z]?-?\d+-\d{4}$/)) {
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
              if (cells[i].match(/^[A-Z]?-?\d+-\d{4}$/)) { rit = cells[i]; startIdx = i; break }
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
    const clicked = await page.evaluate((targetRit) => {
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
