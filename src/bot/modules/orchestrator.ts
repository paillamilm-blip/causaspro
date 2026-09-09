// ============================================================
// CAUSASPRO BOT - Orchestrator
// Flujo: Login → Mis Causas → Listar por año → Leer tabla → Scrape detalles → Sync
// ============================================================

import { chromium, Browser, BrowserContext, Page } from 'playwright'
import type { BotConfig, BotRunStatus, CausaScrapedData, ScrapeSessionResult } from '../types'
import { DEFAULT_CONFIG } from '../config'
import { createStealthContext, loginOJV, logoutOJV, isSessionActive } from './login'
import { navigateToConsulta, searchByYear, searchByRitExacto, navigateToCausaDetail, CausaFoundInPortal } from './search'
import { scrapeCausaCompleta } from './scraper'
import { analyzeCausaUrgency, generateAlertSummary } from './detection'
import { saveCausaData, saveBotRunStatus, markCausaScraped, initSupabase, getCausasToScrape, saveBotError } from './supabaseSync'
import { humanDelay, sleep, isWithinAllowedHours, generateRunId, log, inferirTipoRIT } from '../utils'
import { createClient } from '@supabase/supabase-js'

/**
 * QA / Trazabilidad: toma una screenshot EN EL MOMENTO del fallo (con la page real)
 * y devuelve la ruta guardada, o undefined si no se pudo capturar. Así la captura
 * corresponde exactamente al error que se registra (no a otra corrida ni a un archivo
 * inexistente). El nombre incluye runId + paso para que sea único y rastreable.
 */
async function capturarError(
  page: Page | null,
  runId: string,
  paso: string,
): Promise<string | undefined> {
  if (!page) return undefined
  const ruta = `/tmp/bot_error_${runId}_${paso}.png`
  try {
    await page.screenshot({ path: ruta })
    return ruta
  } catch {
    return undefined
  }
}

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
    // Opciones de lanzamiento. Por defecto usa el Chromium que instala Playwright.
    // Alternativas para NO tener que descargar Chromium (útil si la descarga falla):
    //   - CHROME_PATH=C:\ruta\chrome.exe  → usa un Chrome/Chromium especifico
    //   - BOT_USE_SYSTEM_CHROME=1         → usa el Google Chrome ya instalado (channel)
    const launchOpts: Parameters<typeof chromium.launch>[0] = {
      headless: cfg.headless,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    }
    if (process.env.CHROME_PATH) {
      launchOpts.executablePath = process.env.CHROME_PATH
      log('info', `  Usando Chrome de: ${process.env.CHROME_PATH}`)
    } else if (process.env.BOT_USE_SYSTEM_CHROME === '1') {
      launchOpts.channel = 'chrome'
      log('info', '  Usando el Google Chrome del sistema (channel=chrome)')
    }
    browser = await chromium.launch(launchOpts)
    
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
      // QA: capturar screenshot AHORA (coincide con el fallo) y registrarlo
      const shot = await capturarError(page, runId, 'login')
      await saveBotError('login', `Login fallido: ${loginResult.error}`, {
        runId,
        screenshotPath: shot,
      }).catch(() => {})
      return { status, data: results }
    }
    
    // 3. Navegar a Mis Causas
    const navOk = await navigateToConsulta(page)
    if (!navOk) {
      log('error', 'No se pudo navegar a Mis Causas')
      status.detenido_por = 'error_critico'
      status.errores.push('No se pudo navegar a Mis Causas')
      // QA: capturar screenshot AHORA y registrarlo
      const shot = await capturarError(page, runId, 'navegacion')
      await saveBotError('navegacion', 'No se pudo navegar a Mis Causas', {
        runId,
        screenshotPath: shot,
      }).catch(() => {})
      return { status, data: results }
    }
    
    // 4-6. Buscar y scrapear según el MODO configurado.
    //   BOT_SEARCH_MODE=rit    (DEFAULT) → busca por RIT individual sobre las causas
    //                                       ya cargadas en la BD. Evita el CAPTCHA que
    //                                       dispara el listado masivo (~17.500 registros).
    //   BOT_SEARCH_MODE=listado          → flujo antiguo: lista todo el portal por año.
    const searchMode = (process.env.BOT_SEARCH_MODE || 'rit').toLowerCase()

    if (searchMode === 'listado') {
      await runListadoMasivo(page, cfg, status, results)
    } else {
      await runBusquedaPorRit(page, cfg, status, results)
    }

    // 7. Logout
    if (page) await logoutOJV(page)
    if (!status.detenido_por) status.detenido_por = 'completado'
    
  } catch (error: any) {
    log('error', `Error crítico: ${error.message}`)
    status.detenido_por = 'error_critico'
    status.errores.push(error.message)
    // QA: capturar screenshot del estado al momento del error crítico
    const shot = await capturarError(page, runId, 'critico')
    await saveBotError('critico', error.message, { runId, screenshotPath: shot }).catch(() => {})
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

// ============================================================
// FLUJO POR RIT (DEFAULT) — anti-CAPTCHA
// Lee las causas YA CARGADAS en la BD y busca cada una por su RIT exacto
// (Rit tipo + Rol número + Año), en vez de listar todo el portal.
// ============================================================
async function runBusquedaPorRit(
  page: Page,
  cfg: BotConfig,
  status: BotRunStatus,
  results: CausaScrapedData[]
): Promise<void> {
  // Límite de causas por sesión (anti-detección). BOT_MAX_CAUSAS lo puede ajustar.
  const envMax = process.env.BOT_MAX_CAUSAS ? parseInt(process.env.BOT_MAX_CAUSAS) : undefined
  const maxCausas = envMax && envMax > 0 ? envMax : cfg.maxCausasPorSesion

  // Leer las causas cargadas en la BD, priorizando las menos actualizadas.
  const causas = await getCausasToScrape(maxCausas, cfg.priorizarUrgentes)
  status.total_causas = causas.length
  log('info', `📋 ${causas.length} causas cargadas a revisar (modo RIT, máx ${maxCausas})`)

  if (causas.length === 0) {
    log('warn', 'No hay causas cargadas en la BD para revisar. Cargá causas por Excel primero.')
    status.detenido_por = 'completado'
    return
  }

  for (const causa of causas) {
    status.procesadas++
    log('info', `  [${status.procesadas}/${causas.length}] ${causa.rit}...`)

    try {
      // Buscar la causa por su RIT exacto (1 resultado, sin listado masivo)
      const encontradas = await searchByRitExacto(page, causa.rit)

      if (encontradas.length === 0) {
        status.fallidas++
        status.errores.push(`${causa.rit}: no encontrada en el portal`)
        // Volver al formulario limpio para la siguiente búsqueda
        await navigateToConsulta(page)
        await sleep(1500)
        continue
      }

      // Abrir el detalle y scrapear
      const opened = await navigateToCausaDetail(page, causa.rit)
      if (opened) {
        const scrapedData = await scrapeCausaCompleta(page, { id: causa.id, rit: causa.rit })
        const analysis = analyzeCausaUrgency(scrapedData)
        await saveCausaData(scrapedData, analysis)
        results.push(scrapedData)
        await markCausaScraped(causa.id)
        status.exitosas++

        if (analysis.requiere_accion_inmediata) {
          log('warn', `  ${generateAlertSummary(analysis)}`)
        }
      } else {
        status.fallidas++
        status.errores.push(`${causa.rit}: no se pudo abrir el detalle`)
      }

      // Volver al formulario para la siguiente causa (no history.back — pierde sesión)
      await navigateToConsulta(page)
      await sleep(1500)

    } catch (err: any) {
      status.fallidas++
      status.errores.push(`${causa.rit}: ${err.message}`)
      log('warn', `  Error en ${causa.rit}: ${err.message}`)
      // QA: capturar screenshot AHORA (coincide con el fallo de esta causa) y registrarlo
      const shot = await capturarError(page, status.run_id, `detalle_${causa.rit}`)
      await saveBotError('detalle', err.message, {
        rit: causa.rit,
        causaId: causa.id,
        runId: status.run_id,
        screenshotPath: shot,
      }).catch(() => {})
      // Intentar recuperar la navegación para la siguiente causa
      try {
        await navigateToConsulta(page)
        await sleep(1500)
      } catch {
        log('warn', '  No se pudo recuperar la navegación, continuando...')
      }
    }

    // Delay humanizado entre causas (anti-detección)
    await humanDelay(cfg.delayMin, cfg.delayMax)
  }

  status.detenido_por = 'completado'
}

// ============================================================
// FLUJO LISTADO MASIVO (legacy, BOT_SEARCH_MODE=listado)
// Lista TODO el portal por año y crea causas nuevas. ⚠️ Puede disparar CAPTCHA
// por el volumen (~17.500 registros). Se mantiene como opción/fallback.
// ============================================================
async function runListadoMasivo(
  page: Page,
  cfg: BotConfig,
  status: BotRunStatus,
  results: CausaScrapedData[]
): Promise<void> {
  log('info', 'Listando causas del portal por año (modo listado masivo)...')
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
    return
  }

  // Sincronizar datos básicos con Supabase
  log('info', 'Actualizando datos básicos en Supabase...')
  const supabase = initSupabase()

  for (const pc of allPortalCausas) {
    try {
      const { data: existing } = await supabase
        .from('causas')
        .select('id')
        .eq('rit', pc.rit)
        .limit(1)

      if (existing && existing.length > 0) {
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
        await supabase
          .from('causas')
          .insert({
            rit: pc.rit,
            caratulado: pc.caratulado || null,
            estado: pc.estado_procesal || null,
            tipo: inferirTipoRIT(pc.rit),
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

  // Entrar a detalles de las primeras N causas
  const envMaxDetails = process.env.BOT_MAX_DETAILS ? parseInt(process.env.BOT_MAX_DETAILS) : undefined
  if (envMaxDetails && envMaxDetails > 0) {
    cfg.maxDetailsPorSesion = envMaxDetails
  }
  const maxDetails = cfg.maxDetailsPorSesion
  log('info', `\nExtrayendo detalles de las primeras ${maxDetails} causas...`)

  const causasByYear = new Map<string, CausaFoundInPortal[]>()
  for (const pc of allPortalCausas) {
    const yearMatch = pc.rit.match(/(\d{4})$/)
    const causaYear = yearMatch ? yearMatch[1] : years[0]
    if (!causasByYear.has(causaYear)) causasByYear.set(causaYear, [])
    causasByYear.get(causaYear)!.push(pc)
  }

  let detailCount = 0
  for (const [causaYear, causasInYear] of causasByYear) {
    if (detailCount >= maxDetails) break

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

        await navigateToConsulta(page)
        await sleep(2000)
        await searchByYear(page, causaYear)
        await sleep(2000)

      } catch (err: any) {
        log('warn', `  Error en detalle ${pc.rit}: ${err.message}`)
        try {
          await navigateToConsulta(page)
          await sleep(2000)
          await searchByYear(page, causaYear)
          await sleep(2000)
        } catch {
          log('warn', '  No se pudo recuperar la navegacion, continuando...')
        }
      }

      await humanDelay(cfg.delayMin, cfg.delayMax)
    }
  }

  status.detenido_por = 'completado'
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
