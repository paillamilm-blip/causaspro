// ============================================================
// CAUSASPRO BOT - Orchestrator
// Flujo: Login → Mis Causas → Listar por año → Leer tabla → Scrape detalles → Sync
// ============================================================

import { chromium, Browser, BrowserContext, Page } from 'playwright'
import type { BotConfig, BotRunStatus, CausaScrapedData, ScrapeSessionResult } from '../types'
import { DEFAULT_CONFIG } from '../config'
import { createStealthContext, loginOJV, logoutOJV, isSessionActive } from './login'
import { navigateToConsulta, searchByYear, navigateToCausaDetail, CausaFoundInPortal } from './search'
import { scrapeCausaCompleta } from './scraper'
import { analyzeCausaUrgency, generateAlertSummary } from './detection'
import { saveCausaData, saveBotRunStatus, markCausaScraped, initSupabase } from './supabaseSync'
import { humanDelay, sleep, isWithinAllowedHours, generateRunId, log } from '../utils'
import { createClient } from '@supabase/supabase-js'

/**
 * Ejecuta una sesión completa del bot
 */
export async function runBotSession(
  credentials: { rut: string; password: string },
  config: Partial<BotConfig> = {}
): Promise<ScrapeSessionResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const runId = generateRunId()
  
  const status: BotRunStatus = {
    run_id: runId,
    started_at: new Date().toISOString(),
    total_causas: 0,
    procesadas: 0,
    exitosas: 0,
    fallidas: 0,
    errores: [],
  }
  
  const results: CausaScrapedData[] = []
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let page: Page | null = null
  
  log('info', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  log('info', `🤖 CausasPro Bot — Sesión ${runId}`)
  log('info', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  
  try {
    // 0. Verificar horario
    if (!process.env.SKIP_HOUR_CHECK && !isWithinAllowedHours()) {
      log('warn', 'Fuera de horario permitido. Usa SKIP_HOUR_CHECK=1 para ignorar.')
      status.detenido_por = 'error_critico'
      status.errores.push('Fuera de horario permitido')
      return { status, data: results }
    }
    
    // 1. Lanzar navegador
    log('info', 'Lanzando navegador...')
    browser = await chromium.launch({
      headless: cfg.headless,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    })
    
    context = await createStealthContext(browser)
    page = await context.newPage()
    page.setDefaultTimeout(cfg.selectorTimeout)
    page.setDefaultNavigationTimeout(cfg.navigationTimeout)
    
    // 2. Login
    log('info', 'Intentando login...')
    const loginResult = await loginOJV(page, credentials)
    
    if (!loginResult.success) {
      log('error', `Login fallido: ${loginResult.error}`)
      status.detenido_por = 'error_critico'
      status.errores.push(`Login fallido: ${loginResult.error}`)
      return { status, data: results }
    }
    
    // 3. Navegar a Mis Causas
    const navOk = await navigateToConsulta(page)
    if (!navOk) {
      log('error', 'No se pudo navegar a Mis Causas')
      status.detenido_por = 'error_critico'
      status.errores.push('No se pudo navegar a Mis Causas')
      return { status, data: results }
    }
    
    // 4. Listar causas por año (configurable via BOT_YEARS env var o cfg.years)
    log('info', 'Listando causas del portal por año...')
    const allPortalCausas: CausaFoundInPortal[] = []
    
    const years = process.env.BOT_YEARS ? process.env.BOT_YEARS.split(',').map((y: string) => y.trim()) : cfg.years
    for (const year of years) {
      const causasYear = await searchByYear(page, year)
      allPortalCausas.push(...causasYear)
      
      if (allPortalCausas.length >= cfg.maxCausasPorSesion) {
        log('info', `  Alcanzado límite de ${cfg.maxCausasPorSesion} causas`)
        break
      }
      
      await sleep(3000)
    }
    
    log('info', `📋 ${allPortalCausas.length} causas encontradas en el portal`)
    status.total_causas = allPortalCausas.length
    
    if (allPortalCausas.length === 0) {
      log('warn', 'No se encontraron causas en el portal')
      status.detenido_por = 'completado'
      return { status, data: results }
    }
    
    // 5. Sincronizar con Supabase (actualizar datos básicos de la tabla)
    log('info', 'Actualizando datos básicos en Supabase...')
    const supabase = initSupabase()
    
    for (const pc of allPortalCausas) {
      try {
        // Buscar si existe en la base de datos
        const { data: existing } = await supabase
          .from('causas')
          .select('id')
          .eq('rit', pc.rit)
          .limit(1)
        
        if (existing && existing.length > 0) {
          // Actualizar datos del portal
          await supabase
            .from('causas')
            .update({
              caratulado: pc.caratulado || undefined,
              estado: pc.estado_procesal || undefined,
              updated_at: new Date().toISOString(),
            })
            .eq('rit', pc.rit)
          
          status.exitosas++
        } else {
          // Causa nueva (está en el portal pero no en la BD) → crearla
          await supabase
            .from('causas')
            .insert({
              rit: pc.rit,
              caratulado: pc.caratulado || null,
              estado: pc.estado_procesal || null,
              tipo: pc.rit.startsWith('P') ? 'P' : pc.rit.startsWith('X') ? 'X' : null,
              fecha_apertura: parseDateCL(pc.fecha_ingreso),
              notas: `Tribunal: ${pc.tribunal}. Institución: ${pc.institucion}`,
            })
          
          status.exitosas++
          log('info', `  + Nueva causa: ${pc.rit}`)
        }
        
        status.procesadas++
      } catch (err: any) {
        status.fallidas++
        status.procesadas++
        status.errores.push(`${pc.rit}: ${err.message}`)
      }
    }
    
    // 6. Entrar a detalles de las primeras N causas (para movimientos/audiencias)
    // BOT_MAX_DETAILS controls detail-scrape limit (separate from BOT_MAX_CAUSAS for discovery)
    const envMaxDetails = process.env.BOT_MAX_DETAILS ? parseInt(process.env.BOT_MAX_DETAILS) : undefined
    if (envMaxDetails && envMaxDetails > 0) {
      cfg.maxDetailsPorSesion = envMaxDetails
    }
    const maxDetails = cfg.maxDetailsPorSesion
    log('info', `\nExtrayendo detalles de las primeras ${maxDetails} causas...`)
    
    // Group causas by year so we can re-search the correct year after navigating back
    const causasByYear = new Map<string, CausaFoundInPortal[]>()
    for (const pc of allPortalCausas) {
      // Extract year from RIT (last 4 digits, e.g. C-4875-2025 -> 2025)
      const yearMatch = pc.rit.match(/(\d{4})$/)
      const causaYear = yearMatch ? yearMatch[1] : years[0]
      if (!causasByYear.has(causaYear)) causasByYear.set(causaYear, [])
      causasByYear.get(causaYear)!.push(pc)
    }
    
    let detailCount = 0
    for (const [causaYear, causasInYear] of causasByYear) {
      if (detailCount >= maxDetails) break
      
      // Before scraping details for this year, re-run the search so the results table is populated
      log('info', `  Re-buscando year ${causaYear} para navegar detalles...`)
      await searchByYear(page, causaYear)
      await sleep(2000)
      
      for (const pc of causasInYear) {
        if (detailCount >= maxDetails) break
        detailCount++
        
        log('info', `  [${detailCount}/${maxDetails}] Detalle de ${pc.rit}...`)
        
        try {
          const opened = await navigateToCausaDetail(page, pc.rit)
          
          if (opened) {
            // Extraer datos del detalle
            const { data: causaDb } = await supabase
              .from('causas')
              .select('id')
              .eq('rit', pc.rit)
              .single()
            
            if (causaDb) {
              const scrapedData = await scrapeCausaCompleta(page, { id: causaDb.id, rit: pc.rit })
              const analysis = analyzeCausaUrgency(scrapedData)
              await saveCausaData(scrapedData, analysis)
              results.push(scrapedData)
              await markCausaScraped(causaDb.id)
              
              if (analysis.requiere_accion_inmediata) {
                log('warn', `  ${generateAlertSummary(analysis)}`)
              }
            }
          }
          
          // Safe navigation back to list (page.goBack() loses session)
          // Then re-search the current year so the next detail can be found in the table
          await navigateToConsulta(page)
          await sleep(2000)
          await searchByYear(page, causaYear)
          await sleep(2000)
          
        } catch (err: any) {
          log('warn', `  Error en detalle ${pc.rit}: ${err.message}`)
          // Try to recover navigation state for next iteration
          try {
            await navigateToConsulta(page)
            await sleep(2000)
            await searchByYear(page, causaYear)
            await sleep(2000)
          } catch {
            log('warn', '  No se pudo recuperar la navegacion, continuando...')
          }
        }
        
        // Delay entre detalles
        await humanDelay(cfg.delayMin, cfg.delayMax)
      }
    }
    
    // 7. Logout
    if (page) await logoutOJV(page)
    status.detenido_por = 'completado'
    
  } catch (error: any) {
    log('error', `Error crítico: ${error.message}`)
    status.detenido_por = 'error_critico'
    status.errores.push(error.message)
  } finally {
    if (page) await page.close().catch(() => {})
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
    
    status.finished_at = new Date().toISOString()
    await saveBotRunStatus(status).catch(() => {})
    
    log('info', `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    log('info', `📊 Resumen sesión ${runId}:`)
    log('info', `   Total: ${status.total_causas} | Procesadas: ${status.procesadas}`)
    log('success', `   Exitosas: ${status.exitosas} | Fallidas: ${status.fallidas}`)
    log('info', `   Detenido por: ${status.detenido_por}`)
    if (status.errores.length > 0) log('warn', `   Errores: ${status.errores.length}`)
    log('info', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
  }
  
  return { status, data: results }
}

/**
 * Parsea fecha chilena dd/mm/yyyy a yyyy-mm-dd
 */
function parseDateCL(dateStr: string): string | null {
  if (!dateStr) return null
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!match) return null
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

export async function runUrgentOnly(credentials: { rut: string; password: string }): Promise<ScrapeSessionResult> {
  return runBotSession(credentials, { maxCausasPorSesion: 10, delayMin: 5000, delayMax: 15000 })
}

export async function runTestSingle(credentials: { rut: string; password: string }): Promise<ScrapeSessionResult> {
  return runBotSession(credentials, { maxCausasPorSesion: 5, delayMin: 3000, delayMax: 8000, headless: false })
}
