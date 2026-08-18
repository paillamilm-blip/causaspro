// ============================================================
// CAUSASPRO BOT - Search Module
// Busca causas por RIT en la OJV
// ============================================================

import type { Page } from 'playwright'
import type { CausaToScrape } from '../types'
import { OJV_URLS, OJV_SELECTORS, DEFAULT_CONFIG } from '../config'
import { humanDelay, sleep, log, parseRIT } from '../utils'

/**
 * Navega a la sección "Mis Causas" y lista todas
 * Filtros: Tipo de causa = todos (5/5), Estado = todos (12/12)
 */
export async function navigateToConsulta(page: Page): Promise<boolean> {
  log('info', 'Navegando a Mis Causas...')
  
  try {
    // Intentar click en "Mis Causas" desde el menú
    await page.evaluate(() => {
      const links = document.querySelectorAll('a')
      for (const link of links) {
        const text = (link.textContent || '').trim()
        if (text.includes('Mis Causas') || text.includes('Mis causas')) {
          link.click()
          return true
        }
      }
      return false
    })
    
    await sleep(3000)
    
    // Si no funcionó el click, navegar directo
    if (!page.url().includes('mis_causas') && !page.url().includes('miscausas')) {
      await page.goto('https://oficinajudicialvirtual.pjud.cl/ADIR_871/mis_causas.php', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      await sleep(3000)
    }
    
    log('info', '  En Mis Causas. Configurando filtros...')
    
    // Seleccionar TODOS los tipos de causa (5 de 5)
    try {
      const tipoSelect = await page.$('select[name*="tipo"], select[id*="tipo"], select:has(option:has-text("Protección"))')
      if (tipoSelect) {
        // Seleccionar todas las opciones
        await tipoSelect.selectOption({ index: 0 }) // "Todos" generalmente es index 0
        await sleep(500)
      }
      // O buscar checkbox "Seleccionar todos"
      const selectAllTipo = await page.$('input[type="checkbox"]:near(text("Tipo")), label:has-text("Todos") input')
      if (selectAllTipo) {
        await selectAllTipo.check().catch(() => {})
      }
    } catch {}
    
    // Seleccionar TODOS los estados (12 de 12)
    try {
      const estadoSelect = await page.$('select[name*="estado"], select[id*="estado"]')
      if (estadoSelect) {
        await estadoSelect.selectOption({ index: 0 })
        await sleep(500)
      }
      const selectAllEstado = await page.$('input[type="checkbox"]:near(text("Estado")), label:has-text("Todos") input')
      if (selectAllEstado) {
        await selectAllEstado.check().catch(() => {})
      }
    } catch {}
    
    await sleep(1000)
    
    // Click en buscar/filtrar
    const buscarBtn = await page.$('button:has-text("Buscar"), button:has-text("Filtrar"), input[type="submit"], button[type="submit"]')
    if (buscarBtn) {
      await buscarBtn.click().catch(() => {
        page.evaluate(() => {
          const btn = document.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement
          if (btn) btn.click()
        })
      })
      await sleep(5000)
    }
    
    log('success', '  Mis Causas cargadas')
    return true
    
  } catch (error: any) {
    log('error', `Error navegando a Mis Causas: ${error.message}`)
    return false
  }
}

/**
 * Busca una causa específica por RIT
 * Retorna true si encontró la causa y navegó al detalle
 */
export async function searchByRIT(page: Page, causa: CausaToScrape): Promise<boolean> {
  log('info', `Buscando causa ${causa.rit}...`)
  
  try {
    const ritParsed = parseRIT(causa.rit)
    if (!ritParsed) {
      log('warn', `RIT inválido: ${causa.rit}`)
      return false
    }
    
    // Buscar el campo de búsqueda por RIT
    // El portal puede tener campos separados para tipo, número y año
    const singleRitInput = await findSearchInput(page)
    
    if (singleRitInput) {
      // Campo único de RIT
      await singleRitInput.click()
      await sleep(300 + Math.random() * 500)
      await singleRitInput.fill('')
      await sleep(200)
      
      // Escribir RIT completo
      await typeWithDelay(page, singleRitInput, causa.rit)
      
    } else {
      // Campos separados: tipo (letra), número, año
      const success = await fillSeparatedRITFields(page, ritParsed)
      if (!success) {
        log('error', `No se encontraron campos de búsqueda para ${causa.rit}`)
        return false
      }
    }
    
    // Seleccionar tribunal si está disponible y tenemos la info
    if (causa.tribunal) {
      await selectTribunal(page, causa.tribunal)
    }
    
    // Esperar un momento antes de buscar (humano)
    await sleep(800 + Math.random() * 1500)
    
    // Click en buscar
    const searchBtn = await findSearchButton(page)
    if (searchBtn) {
      await searchBtn.click()
    } else {
      // Fallback: Enter
      await page.keyboard.press('Enter')
    }
    
    // Esperar resultados
    await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_CONFIG.navigationTimeout })
    await sleep(2000 + Math.random() * 2000)
    
    // Verificar si hay resultados
    const hasResults = await checkSearchResults(page, causa.rit)
    
    if (hasResults) {
      log('success', `Causa ${causa.rit} encontrada`)
      return true
    }
    
    log('warn', `Causa ${causa.rit} no encontrada en resultados`)
    return false
    
  } catch (error: any) {
    log('error', `Error buscando ${causa.rit}: ${error.message}`)
    return false
  }
}

/**
 * Navega al detalle de la causa desde los resultados de búsqueda
 */
export async function navigateToCausaDetail(page: Page, rit: string): Promise<boolean> {
  try {
    // Buscar link a la causa en la tabla de resultados
    const causaLink = await page.$(`a:has-text("${rit}"), tr:has-text("${rit}") a, a[href*="detalle"]`)
    
    if (causaLink) {
      await sleep(500 + Math.random() * 1000)
      await causaLink.click()
      await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_CONFIG.navigationTimeout })
      await sleep(2000)
      log('success', `Navegado al detalle de ${rit}`)
      return true
    }
    
    // Si la búsqueda fue directa y ya estamos en el detalle
    const movimientosTab = await page.$(OJV_SELECTORS.tabMovimientos)
    if (movimientosTab) {
      log('info', 'Ya estamos en el detalle de la causa')
      return true
    }
    
    // Intentar hacer click en la primera fila de resultados
    const firstRow = await page.$('table tbody tr:first-child a, .resultado:first-child a')
    if (firstRow) {
      await firstRow.click()
      await page.waitForLoadState('domcontentloaded')
      await sleep(2000)
      return true
    }
    
    log('warn', 'No se pudo navegar al detalle de la causa')
    return false
    
  } catch (error: any) {
    log('error', `Error navegando al detalle: ${error.message}`)
    return false
  }
}

// ============================================================
// HELPERS PRIVADOS
// ============================================================

async function findSearchInput(page: Page): Promise<any | null> {
  const selectors = [
    '#rit',
    'input[name="rit"]',
    'input[placeholder*="RIT"]',
    'input[placeholder*="rit"]',
    'input[name="rol"]',
    '#txtRit',
    'input[id*="rit" i]',
  ]
  
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el && await el.isVisible()) return el
    } catch {}
  }
  return null
}

async function fillSeparatedRITFields(
  page: Page, 
  rit: { tipo: string; numero: string; año: string }
): Promise<boolean> {
  try {
    // Campo tipo (P, C, X, etc.)
    const tipoField = await page.$('input[name*="tipo"], select[name*="tipo"], #tipoRit, input[maxlength="1"]')
    if (tipoField) {
      const tagName = await tipoField.evaluate((el: Element) => el.tagName)
      if (tagName === 'SELECT') {
        await tipoField.selectOption({ label: rit.tipo })
      } else {
        await tipoField.fill(rit.tipo)
      }
      await sleep(300)
    }
    
    // Campo número
    const numField = await page.$('input[name*="numero"], input[name*="rol"], #numRit, input[type="number"]')
    if (numField) {
      await numField.fill(rit.numero)
      await sleep(300)
    }
    
    // Campo año
    const yearField = await page.$('input[name*="ano"], input[name*="año"], select[name*="ano"], #anoRit')
    if (yearField) {
      const tagName = await yearField.evaluate((el: Element) => el.tagName)
      if (tagName === 'SELECT') {
        await yearField.selectOption({ value: rit.año })
      } else {
        await yearField.fill(rit.año)
      }
      await sleep(300)
    }
    
    return true
  } catch {
    return false
  }
}

async function selectTribunal(page: Page, tribunal: string): Promise<void> {
  try {
    const select = await page.$(OJV_SELECTORS.searchTribunalSelect)
    if (select) {
      // Buscar opción que contenga el nombre del tribunal
      const options = await select.$$('option')
      for (const option of options) {
        const text = await option.textContent()
        if (text && text.toLowerCase().includes(tribunal.toLowerCase())) {
          const value = await option.getAttribute('value')
          if (value) {
            await select.selectOption({ value })
            await sleep(500)
          }
          break
        }
      }
    }
  } catch {}
}

async function findSearchButton(page: Page): Promise<any | null> {
  const selectors = [
    '#btnBuscar',
    'button:has-text("Buscar")',
    'input[value="Buscar"]',
    'input[type="submit"]',
    'button[type="submit"]',
    'a:has-text("Buscar")',
    '.btn-buscar',
  ]
  
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el && await el.isVisible()) return el
    } catch {}
  }
  return null
}

async function checkSearchResults(page: Page, rit: string): Promise<boolean> {
  // Verificar si hay resultados
  const noResults = await page.$(':has-text("No se encontraron"), :has-text("sin resultados"), :has-text("0 resultado")')
  if (noResults) return false
  
  // Verificar si hay tabla de resultados o si estamos en el detalle directo
  const resultsTable = await page.$('table tbody tr, .resultado-causa, .detalle-causa')
  if (resultsTable) return true
  
  // Verificar si el RIT aparece en la página
  const pageContent = await page.textContent('body')
  if (pageContent && pageContent.includes(rit)) return true
  
  return false
}

async function typeWithDelay(page: Page, element: any, text: string): Promise<void> {
  for (const char of text) {
    await element.type(char, { delay: 80 + Math.random() * 120 })
  }
}
