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
import { saveCausaData, saveBotRunStatus, markCausaScraped, initSupabase, getCausasToScrape, saveBotError, saveStepMetric } from './supabaseSync'
import { humanDelay, sleep, isWithinAllowedHours, generateRunId, log, inferirTipoRIT, categorizarError, capturaPath } from '../utils'
import { analizarHistorial, logDiagnostico } from './learningEngine'
import type { BotStep, BotErrorType } from '../types'

/**
 * Envuelve un paso del flujo: mide su duración y registra una fila en
 * bot_step_metrics (éxito o fallo + tipo de error). Devuelve el resultado
 * de la función. Si la función lanza, registra el fallo y re-lanza para que
 * el llamador maneje el control de flujo como siempre.
 *
 * Es el ladrillo del "aprendizaje": con esto sabemos cuánto tarda y cuánto
 * falla CADA etapa, sin cambiar la lógica del bot.
 */
async function medirPaso<T>(
  runId: string,
  paso: BotStep,
  fn: () => Promise<T>,
  rit?: string,
  // Predicado opcional: define si el RESULTADO cuenta como éxito. Útil cuando la
  // función no lanza pero devuelve un "vacío" que en realidad es un fallo
  // (ej: searchByRitExacto devuelve [] = no encontrada). Si se omite, todo lo que
  // no lance se considera éxito. Evita registrar dos filas contradictorias del mismo paso.
  esExito?: (res: T) => boolean,
  tipoErrorSiVacio?: BotErrorType,
): Promise<T> {
  const inicio = Date.now()
  try {
    const res = await fn()
    const ok = esExito ? esExito(res) : true
    // La telemetría NUNCA debe afectar el scraping: se traga cualquier fallo propio.
    await saveStepMetric({
      run_id: runId,
      rit,
      paso,
      duracion_ms: Date.now() - inicio,
      exito: ok,
      tipo_error: ok ? undefined : (tipoErrorSiVacio || 'no_encontrada'),
    }).catch(() => {})
    return res
  } catch (err: any) {
    const tipo: BotErrorType = categorizarError(err?.message)
    await saveStepMetric({
      run_id: runId,
      rit,
      paso,
      duracion_ms: Date.now() - inicio,
      exito: false,
      tipo_error: tipo,
    }).catch(() => {})
    throw err
  }
}

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
  const ruta = capturaPath(`bot_error_${runId}_${paso}.png`)
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
    
    // 0.5. APRENDIZAJE (modo conservador): leer el historial y mostrar consejos.
    //      Solo informa — no cambia delays, orden ni config. Nunca bloquea la corrida.
    try {
      const diag = await analizarHistorial()
      logDiagnostico(diag)
    } catch (e: any) {
      log('warn', `No se pudo analizar el historial (se continúa igual): ${e?.message ?? e}`)
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
    
    // 2. Login. OJO: loginOJV/navigateToConsulta devuelven success:false / false
    //    en el camino de fallo esperado (no lanzan). Por eso NO se envuelven en
    //    medirPaso (que solo detecta fallo si la fn lanza); se mide a mano y se
    //    registra el paso con el éxito REAL según el valor de retorno.
    log('info', 'Intentando login...')
    const tLogin = Date.now()
    const loginResult = await loginOJV(page, credentials)
    await saveStepMetric({
      run_id: runId, paso: 'login', duracion_ms: Date.now() - tLogin,
      exito: loginResult.success,
      tipo_error: loginResult.success ? undefined : categorizarError(loginResult.error),
    }).catch(() => {})

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
    
    // 3. Navegar a Mis Causas (mismo patrón: se mide a mano por el retorno booleano)
    const tNav = Date.now()
    const navOk = await navigateToConsulta(page)
    await saveStepMetric({
      run_id: runId, paso: 'navegacion', duracion_ms: Date.now() - tNav,
      exito: navOk, tipo_error: navOk ? undefined : 'navegacion',
    }).catch(() => {})
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
    status.search_mode = searchMode

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

    // Métricas de auto-aprendizaje (derivadas): duración, velocidad y tasa de éxito.
    // Se calculan aquí para que queden guardadas en bot_runs y el motor las lea luego.
    const durMs = new Date(status.finished_at).getTime() - new Date(status.started_at).getTime()
    status.duracion_ms = durMs
    // causas_por_min = velocidad de scraping ÚTIL → usa exitosas (no procesadas,
    // que incluye fallidas y daría una "velocidad" engañosa).
    status.causas_por_min = durMs > 0 ? Number(((status.exitosas / durMs) * 60000).toFixed(2)) : 0
    status.tasa_exito = status.procesadas > 0
      ? Number(((status.exitosas / status.procesadas) * 100).toFixed(2))
      : 0
    // Marca de bloqueo: si la sesión se detuvo por captcha/bloqueo
    if (status.detenido_por === 'captcha' || status.detenido_por === 'bloqueado') {
      status.bloqueo_detectado = true
    }

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
      // Buscar la causa por su RIT exacto (1 resultado, sin listado masivo).
      // Instrumentado: mide cuánto tarda. Un array vacío = "no encontrada" = fallo,
      // así medirPaso registra UNA sola fila con el resultado correcto (no dos).
      const encontradas = await medirPaso(
        status.run_id, 'busqueda',
        () => searchByRitExacto(page, causa.rit),
        causa.rit,
        (res) => res.length > 0,   // éxito solo si encontró la causa
        'no_encontrada',
      )

      if (encontradas.length === 0) {
        status.fallidas++
        status.errores.push(`${causa.rit}: no encontrada en el portal`)
        // (La métrica del paso 'busqueda' con exito=false ya la registró medirPaso.)
        // Volver al formulario limpio para la siguiente búsqueda
        await navigateToConsulta(page)
        await sleep(1500)
        continue
      }

      // Abrir el detalle y scrapear (instrumentado + reintento seguro).
      // IMPORTANTE: usamos el RIT RESUELTO por el portal (encontradas[0].rit, que ya pasó
      // el filtro exacto/fail-closed del PASO 9), NO el causa.rit del usuario. Así la fila
      // que se abre es EXACTAMENTE la validada como encontrada (el portal puede mostrar el
      // prefijo de letra aunque el usuario lo tenga sin letra), evitando abrir otra fila.
      const ritResuelto = encontradas[0].rit
      const opened = await medirPaso(
        status.run_id, 'detalle',
        () => navigateToCausaDetail(page, ritResuelto),
        causa.rit,
      )
      if (opened) {
        const scrapedData = await medirPaso(
          status.run_id, 'scrape',
          () => scrapeCausaCompleta(page, { id: causa.id, rit: causa.rit }),
          causa.rit,
        )
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
      // Aprendizaje: si el error parece bloqueo/CAPTCHA, marcar la sesión.
      if (categorizarError(err?.message) === 'captcha') {
        status.bloqueo_detectado = true
      }
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
