// ============================================================
// CAUSASPRO BOT - Orchestrator
// Controla la ejecución completa: login → scrape → sync
// Anti-detección: delays humanos, límite de sesión, horario
// ============================================================

import { chromium, Browser, BrowserContext, Page } from 'playwright'
import type { BotConfig, BotRunStatus, CausaScrapedData, CausaToScrape, ScrapeSessionResult } from '../types'
import { DEFAULT_CONFIG } from '../config'
import { createStealthContext, loginOJV, logoutOJV, isSessionActive } from './login'
import { navigateToConsulta, searchByRIT, navigateToCausaDetail } from './search'
import { scrapeCausaCompleta } from './scraper'
import { analyzeCausaUrgency, generateAlertSummary } from './detection'
import { getCausasToScrape, saveCausaData, saveBotRunStatus, markCausaScraped } from './supabaseSync'
import { humanDelay, sleep, isWithinAllowedHours, generateRunId, log } from '../utils'

/**
 * Ejecuta una sesión completa del bot
 * - Login
 * - Scrapear N causas (con delays anti-detección)
 * - Sync con Supabase
 * - Logout
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
  log('info', `🤖 CausasPro Bot - Sesión ${runId}`)
  log('info', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  
  try {
    // 0. Verificar horario permitido
    if (!isWithinAllowedHours()) {
      log('warn', 'Fuera de horario permitido (8-18h Chile). Abortando.')
      status.detenido_por = 'error_critico'
      status.errores.push('Fuera de horario permitido')
      return { status, data: results }
    }
    
    // 1. Lanzar navegador
    log('info', 'Lanzando navegador...')
    browser = await chromium.launch({
      headless: cfg.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    })
    
    context = await createStealthContext(browser)
    page = await context.newPage()
    
    // Configurar timeouts
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
    
    // 3. Obtener causas a scrapear
    log('info', `Obteniendo causas a scrapear (max ${cfg.maxCausasPorSesion})...`)
    const causas = await getCausasToScrape(cfg.maxCausasPorSesion, cfg.priorizarUrgentes)
    status.total_causas = causas.length
    
    if (causas.length === 0) {
      log('warn', 'No hay causas para scrapear')
      status.detenido_por = 'completado'
      return { status, data: results }
    }
    
    log('info', `📋 ${causas.length} causas a procesar`)
    
    // 4. Navegar a consulta de causas
    const navOk = await navigateToConsulta(page)
    if (!navOk) {
      log('error', 'No se pudo navegar a la sección de consulta')
      status.detenido_por = 'error_critico'
      status.errores.push('No se pudo navegar a consulta de causas')
      return { status, data: results }
    }
    
    // 5. Scrapear cada causa
    for (let i = 0; i < causas.length; i++) {
      const causa = causas[i]
      
      log('info', `\n[${i + 1}/${causas.length}] Procesando ${causa.rit}...`)
      
      // Verificar sesión activa
      if (!await isSessionActive(page)) {
        log('error', 'Sesión expirada. Abortando.')
        status.detenido_por = 'error_critico'
        status.errores.push('Sesión expirada durante scraping')
        break
      }
      
      // Verificar si hay captcha o bloqueo
      const captcha = await page.$('.captcha, .g-recaptcha, [class*="captcha"]')
      if (captcha) {
        log('error', '🛑 CAPTCHA detectado. Deteniendo bot.')
        status.detenido_por = 'captcha'
        status.errores.push('CAPTCHA detectado durante sesión')
        break
      }
      
      try {
        // Buscar la causa
        const found = await searchByRIT(page, causa)
        
        if (!found) {
          log('warn', `  ${causa.rit} no encontrada`)
          status.fallidas++
          status.procesadas++
          continue
        }
        
        // Navegar al detalle
        const inDetail = await navigateToCausaDetail(page, causa.rit)
        
        if (!inDetail) {
          log('warn', `  No se pudo abrir detalle de ${causa.rit}`)
          status.fallidas++
          status.procesadas++
          continue
        }
        
        // Scrapear datos completos
        const scrapedData = await scrapeCausaCompleta(page, causa)
        
        // Analizar urgencia
        const analysis = analyzeCausaUrgency(scrapedData)
        
        // Guardar en Supabase
        const saved = await saveCausaData(scrapedData, analysis)
        
        if (saved) {
          status.exitosas++
          results.push(scrapedData)
          await markCausaScraped(causa.id)
          
          // Mostrar alerta si es urgente
          if (analysis.requiere_accion_inmediata) {
            log('warn', `  ${generateAlertSummary(analysis)}`)
          }
        } else {
          status.fallidas++
        }
        
        status.procesadas++
        
      } catch (error: any) {
        log('error', `  Error procesando ${causa.rit}: ${error.message}`)
        status.fallidas++
        status.procesadas++
        status.errores.push(`${causa.rit}: ${error.message}`)
        
        // Si es un error de navegación, tomar screenshot
        if (cfg.screenshotOnError && page) {
          try {
            await page.screenshot({ 
              path: `/tmp/bot_error_${causa.rit.replace(/[^a-zA-Z0-9]/g, '_')}.png` 
            })
          } catch {}
        }
      }
      
      // ANTI-DETECCIÓN: Delay entre causas
      if (i < causas.length - 1) {
        await humanDelay(cfg.delayMin, cfg.delayMax)
      }
      
      // Verificar límite de sesión (por si queremos cortar antes)
      if (status.procesadas >= cfg.maxCausasPorSesion) {
        log('info', `Límite de sesión alcanzado (${cfg.maxCausasPorSesion} causas)`)
        status.detenido_por = 'limite_sesion'
        break
      }
      
      // Volver a la página de búsqueda para la siguiente causa
      await navigateToConsulta(page)
      await sleep(1000 + Math.random() * 2000)
    }
    
    // 6. Logout limpio
    if (page) {
      await logoutOJV(page)
    }
    
    status.detenido_por = status.detenido_por || 'completado'
    
  } catch (error: any) {
    log('error', `Error crítico en sesión: ${error.message}`)
    status.detenido_por = 'error_critico'
    status.errores.push(error.message)
  } finally {
    // Cerrar navegador
    if (page) await page.close().catch(() => {})
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
    
    // Guardar status
    status.finished_at = new Date().toISOString()
    await saveBotRunStatus(status).catch(() => {})
    
    // Resumen final
    log('info', `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    log('info', `📊 Resumen sesión ${runId}:`)
    log('info', `   Total: ${status.total_causas} | Procesadas: ${status.procesadas}`)
    log('success', `   Exitosas: ${status.exitosas} | Fallidas: ${status.fallidas}`)
    log('info', `   Detenido por: ${status.detenido_por}`)
    if (status.errores.length > 0) {
      log('warn', `   Errores: ${status.errores.length}`)
    }
    log('info', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
  }
  
  return { status, data: results }
}

/**
 * Ejecuta el bot en modo "solo las urgentes"
 * Scrapea solo las causas con nivel_urgencia alto
 */
export async function runUrgentOnly(
  credentials: { rut: string; password: string }
): Promise<ScrapeSessionResult> {
  return runBotSession(credentials, {
    maxCausasPorSesion: 10, // Menos causas, más rápido
    delayMin: 20000,         // Delays menores (es urgente)
    delayMax: 60000,
    priorizarUrgentes: true,
  })
}

/**
 * Ejecuta una prueba rápida (1 causa) para verificar que todo funciona
 */
export async function runTestSingle(
  credentials: { rut: string; password: string },
  rit: string
): Promise<ScrapeSessionResult> {
  return runBotSession(credentials, {
    maxCausasPorSesion: 1,
    delayMin: 5000,
    delayMax: 10000,
    screenshotOnError: true,
    headless: false, // Visible para debugging
  })
}
