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
import { volcarDetalleParaDiagnostico } from './diagnostico'
import { analyzeCausaUrgency, generateAlertSummary } from './detection'
import { saveCausaData, saveBotRunStatus, markCausaScraped, initSupabase, getCausasToScrape, saveBotError, saveStepMetric, getCausasToFixLetras, updateCausaRitYTipo, marcarRevisionLetra, upsertCausaHermana, vincularCausaEnNotas, marcarCausaNoEnPortal, limpiarMarcasNoEnPortal } from './supabaseSync'
import { humanDelay, sleep, isWithinAllowedHours, generateRunId, log, inferirTipoRIT, parseRIT, categorizarError, capturaPath } from '../utils'
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

    // BOT_FIX_LETRAS=1 → modo especial de mantenimiento: corrige la letra/tipo del RIT
    // de las causas de la BD contra el portal (fuente de verdad). NO scrapea movimientos.
    // Es OPT-IN y aislado: si la flag no está, el bot corre exactamente como siempre.
    if (process.env.BOT_FIX_LETRAS === '1') {
      status.search_mode = 'fix_letras'
      await runFixLetras(page, cfg, status)
    } else if (searchMode === 'listado') {
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
    if (status.solo_diagnostico) log('warn', `   Solo diagnóstico (NO persistidas): ${status.solo_diagnostico}`)
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

  // OVERRIDE PUNTUAL: BOT_RIT fuerza procesar SOLO los RIT indicados, saltándose la
  // selección automática (getCausasToScrape). Acepta UNO o VARIOS RIT separados por coma
  // (ej. BOT_RIT="P-7336-2026,P-5218-2025,P-701-2025"). Útil para pruebas controladas de
  // causas concretas (ej. 3 causas de Familia) sin depender de qué haya en la BD.
  // Por cada RIT: si existe en la BD usamos su id real y SÍ se persiste normalmente; si NO
  // existe, usamos un id temporal "temp-<rit>" → la causa se scrapea/diagnostica pero NO se
  // persiste (el id no es UUID y fallaría la FK), se marca como SOLO DIAGNÓSTICO
  // (status.solo_diagnostico) y NO se cuenta como exitosa (ver loop abajo).
  let causas: Array<{ id: string; rit: string }>
  const ritOverrideRaw = (process.env.BOT_RIT || '').trim()
  if (ritOverrideRaw) {
    // Separar por coma (o punto y coma), limpiar espacios y descartar vacíos/duplicados.
    let rits = Array.from(new Set(
      ritOverrideRaw.split(/[,;]/).map(r => r.trim()).filter(Boolean)
    ))
    // ANTI-CAPTCHA: respetar el mismo límite maxCausas que el flujo automático. Si se
    // pasaron más RIT que el límite, se recorta y se avisa (el portal PJUD vigila bots).
    if (rits.length > maxCausas) {
      log('warn', `  BOT_RIT trae ${rits.length} RIT pero el límite anti-detección es ${maxCausas}; se procesan los primeros ${maxCausas}.`)
      rits = rits.slice(0, maxCausas)
    }
    // Cliente Supabase una sola vez (no re-inicializar por cada RIT).
    let sb: ReturnType<typeof initSupabase> | null = null
    try { sb = initSupabase() } catch { sb = null }
    causas = []
    for (const rit of rits) {
      let id = `temp-${rit}`
      try {
        if (sb) {
          const { data } = await sb.from('causas').select('id').eq('rit', rit).limit(1)
          if (data && data.length > 0) id = data[0].id
          else log('warn', `  BOT_RIT: "${rit}" no está en la BD; se usa id temporal (no persiste con FK).`)
        }
      } catch (e: any) {
        log('warn', `  No se pudo buscar el id de "${rit}" en la BD (se usa id temporal): ${e?.message ?? e}`)
      }
      causas.push({ id, rit })
    }
    log('info', `🎯 BOT_RIT activo: procesando SOLO ${causas.length} causa(s): ${causas.map(c => c.rit).join(', ')}`)
  } else {
    // RECUPERACIÓN opt-in: BOT_LIMPIAR_NO_EN_PORTAL=1 quita todas las marcas [NO EN PORTAL]
    // antes de armar la cola, para reintentar causas que quedaron marcadas de más.
    if (process.env.BOT_LIMPIAR_NO_EN_PORTAL === '1') {
      const n = await limpiarMarcasNoEnPortal()
      log('info', `  🧹 BOT_LIMPIAR_NO_EN_PORTAL: se quitaron ${n} marca(s) [NO EN PORTAL]; esas causas vuelven a la cola.`)
    }
    // Leer las causas cargadas en la BD, priorizando las que aún NO tienen datos.
    causas = await getCausasToScrape(maxCausas, cfg.priorizarUrgentes)
  }
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
      // portalConfirmoNoExiste: SOLO se pone true si el portal confirmó explícitamente
      // "no existen causas" (mensaje real, doble confirmación). Un [] por timeout/panel
      // no cargado/ambigüedad/excepción NO lo activa → así NUNCA marcamos [NO EN PORTAL]
      // una causa real de menores por un fallo transitorio (bug crítico evitado).
      let portalConfirmoNoExiste = false
      const encontradas = await medirPaso(
        status.run_id, 'busqueda',
        () => searchByRitExacto(page, causa.rit, undefined, () => { portalConfirmoNoExiste = true }),
        causa.rit,
        (res) => res.length > 0,   // éxito solo si encontró la causa
        'no_encontrada',
      )

      if (encontradas.length === 0) {
        status.fallidas++
        status.errores.push(`${causa.rit}: no encontrada en el portal`)
        // Marcar [NO EN PORTAL] SOLO si el portal CONFIRMÓ que no existe (no ante un fallo
        // transitorio). Así la causa deja de reintentarse en cada tanda, pero una causa
        // real que falló por timeout/flakiness NO se pierde: se reintentará normalmente.
        // (Nunca marcar ids temporales de BOT_RIT.)
        if (portalConfirmoNoExiste && !causa.id.startsWith('temp-')) {
          await marcarCausaNoEnPortal(causa.id).catch(() => {})
        }
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
        // DIAGNÓSTICO (opt-in con BOT_DIAG_DETALLE=1): fotografía la estructura
        // REAL del detalle (HTML + resumen de tablas/tabs) ANTES de scrapear, para
        // poder reescribir los extractores sin adivinar selectores. No afecta el
        // scraping: es totalmente defensivo y solo escribe archivos en bot-capturas/.
        if (process.env.BOT_DIAG_DETALLE === '1') {
          await volcarDetalleParaDiagnostico(page, causa.rit).catch(() => {})
        }
        const scrapedData = await medirPaso(
          status.run_id, 'scrape',
          () => scrapeCausaCompleta(page, { id: causa.id, rit: causa.rit }),
          causa.rit,
        )
        const analysis = analyzeCausaUrgency(scrapedData)
        results.push(scrapedData)

        // Un id "temp-*" (BOT_RIT sobre una causa que NO está en la BD) NO es un UUID y
        // no satisface la FK causa_id → cualquier insert/update se rechazaría en silencio.
        // En ese caso NO intentamos persistir y NO lo contamos como éxito engañoso: es una
        // corrida de SOLO DIAGNÓSTICO. Así el resumen no miente ("exitosas") y la BD no
        // recibe escrituras condenadas a fallar.
        const esDiagnosticoSinPersistir = causa.id.startsWith('temp-')
        if (esDiagnosticoSinPersistir) {
          status.solo_diagnostico = (status.solo_diagnostico || 0) + 1
          log('warn', `  🔎 ${causa.rit}: SOLO DIAGNÓSTICO (id temporal) — datos NO persistidos. `
            + `${scrapedData.movimientos.length} mov, ${scrapedData.audiencias.length} aud, ${scrapedData.resoluciones.length} res`)
        } else {
          await saveCausaData(scrapedData, analysis)
          await markCausaScraped(causa.id)
          status.exitosas++
        }

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
// FLUJO FIX LETRAS (BOT_FIX_LETRAS=1) — mantenimiento, OPT-IN
// ------------------------------------------------------------
// Corrige la LETRA/TIPO del RIT de las causas de la BD usando el portal PJUD como
// fuente de verdad. Por cada causa:
//   1. Busca por NÚMERO+AÑO (sin letra) → el portal devuelve la fila con su letra REAL.
//   2. Lee la letra real (encontradas[0].rit).
//   3. Si difiere de la letra/tipo en BD → la corrige (rit + tipo).
//   4. Si el portal es AMBIGUO (mismo número+año, varias letras) → NO adivina: marca
//      la causa para revisión humana (campo notas).
//   5. Si no la encuentra → la deja igual (no borra ni inventa).
// NUNCA inventa la letra. NO scrapea movimientos/audiencias (eso es del flujo normal).
// Respeta el mismo límite anti-CAPTCHA (maxCausas) y los delays humanizados.
// ============================================================
/**
 * Texto legible del vínculo entre dos causas hermanas. Si el par es P↔X, explicita
 * el significado legal (protección con cumplimiento → hay sentencia). Si no, vínculo genérico.
 */
function describeVinculo(ritA: string, ritB: string): string {
  const letras = [parseRIT(ritA)?.tipo, parseRIT(ritB)?.tipo].map(l => (l || '').toUpperCase())
  const esPyX = letras.includes('P') && letras.includes('X')
  const sufijo = esPyX
    ? ' (protección con cumplimiento — hay sentencia)'
    : ''
  return `${ritA} ↔ ${ritB}${sufijo}`
}

async function runFixLetras(
  page: Page,
  cfg: BotConfig,
  status: BotRunStatus,
): Promise<void> {
  const envMax = process.env.BOT_MAX_CAUSAS ? parseInt(process.env.BOT_MAX_CAUSAS) : undefined
  const maxCausas = envMax && envMax > 0 ? envMax : cfg.maxCausasPorSesion

  // OVERRIDE opcional: BOT_RIT permite fijar QUÉ causas revisar (por RIT), útil para probar
  // el fix sobre unas pocas causas concretas antes de correrlo masivo. Si no, se toman de
  // la BD priorizando las que NO tienen letra (tipo NULL).
  let causas: Array<{ id: string; rit: string; tipo: string | null }>
  const ritOverrideRaw = (process.env.BOT_RIT || '').trim()
  if (ritOverrideRaw) {
    let rits = Array.from(new Set(ritOverrideRaw.split(/[,;]/).map(r => r.trim()).filter(Boolean)))
    if (rits.length > maxCausas) {
      log('warn', `  BOT_RIT trae ${rits.length} RIT pero el límite anti-detección es ${maxCausas}; se revisan los primeros ${maxCausas}.`)
      rits = rits.slice(0, maxCausas)
    }
    let sb: ReturnType<typeof initSupabase> | null = null
    try { sb = initSupabase() } catch (e: any) { sb = null }
    // Si no hay conexión a la BD, FIX_LETRAS no puede corregir NADA (necesita leer/escribir
    // causas). Abortar RUIDOSAMENTE en vez de degradar a "0 causas" (que el operador
    // confundiría con "no había nada que corregir").
    if (!sb) {
      log('error', 'FIX_LETRAS: no se pudo conectar a la BD (revisá SUPABASE_URL/SERVICE_ROLE_KEY). Se aborta el modo.')
      status.detenido_por = 'error_critico'
      status.errores.push('FIX_LETRAS: sin conexión a la BD')
      return
    }
    causas = []
    for (const rit of rits) {
      let id = `temp-${rit}`
      let tipo: string | null = null
      try {
        if (sb) {
          const { data } = await sb.from('causas').select('id, tipo').eq('rit', rit).limit(1)
          if (data && data.length > 0) { id = data[0].id; tipo = data[0].tipo ?? null }
          else log('warn', `  FIX_LETRAS: "${rit}" no está en la BD; se omite (no hay causa que corregir).`)
        }
      } catch (e: any) {
        log('warn', `  No se pudo buscar "${rit}" en la BD: ${e?.message ?? e}`)
      }
      // Solo revisamos causas que existan en la BD (hay algo que corregir).
      if (!id.startsWith('temp-')) causas.push({ id, rit, tipo })
    }
    log('info', `🎯 FIX_LETRAS + BOT_RIT: revisando ${causas.length} causa(s): ${causas.map(c => c.rit).join(', ')}`)
  } else {
    causas = await getCausasToFixLetras(maxCausas)
  }

  status.total_causas = causas.length
  log('info', `📋 FIX_LETRAS: ${causas.length} causa(s) a revisar (máx ${maxCausas}). NO se scrapean movimientos.`)

  if (causas.length === 0) {
    log('warn', 'No hay causas para revisar letra. (¿Cargaste causas por Excel?)')
    status.detenido_por = 'completado'
    return
  }

  // Contadores propios del modo, para un resumen honesto al final.
  let corregidas = 0, confirmadas = 0, ambiguas = 0, noEncontradas = 0, colisiones = 0, relacionadas = 0

  for (const causa of causas) {
    status.procesadas++
    const parsed = parseRIT(causa.rit)
    if (!parsed) {
      log('warn', `  [${status.procesadas}/${causas.length}] ${causa.rit}: RIT no parseable, se omite.`)
      status.fallidas++
      continue
    }
    // Buscar SIEMPRE por número+año SIN letra, para que el portal devuelva la letra REAL
    // sin que nuestro propio prefijo (posiblemente equivocado) filtre el resultado.
    const ritSinLetra = `${parsed.numero}-${parsed.año}`
    log('info', `  [${status.procesadas}/${causas.length}] Revisando ${causa.rit} (busco ${ritSinLetra})...`)

    try {
      let candidatosAmbiguos: string[] | null = null
      const encontradas = await medirPaso(
        status.run_id, 'busqueda',
        () => searchByRitExacto(page, ritSinLetra, (cands) => { candidatosAmbiguos = cands }),
        causa.rit,
        (res) => res.length > 0 || candidatosAmbiguos !== null, // ambiguo también es "resuelto"
        'no_encontrada',
      )

      if (candidatosAmbiguos !== null) {
        // El portal devuelve VARIAS letras para el mismo número+año. En Familia esto
        // NO es necesariamente un error: una protección (P) que llega a cumplimiento
        // genera un ingreso SEPARADO con letra X, y AMBAS coexisten (la P queda como
        // antecedente). Regla legal (confirmada): NO pisar una por otra.
        //
        // Canonizamos los candidatos del portal y separamos:
        //   - el que coincide con la letra que YA tiene esta causa en la BD (si está)
        //   - los "hermanos" (otras letras del mismo número+año)
        const cands = (candidatosAmbiguos as string[])
          .map(r => parseRIT(r))
          .filter((p): p is NonNullable<typeof p> => !!p && !!p.tipo)
          .map(p => ({ letra: p.tipo, rit: `${p.tipo}-${String(parseInt(p.numero, 10))}-${p.año}` }))
        // Deduplicar por rit canónico.
        const canonUnicos = Array.from(new Map(cands.map(c => [c.rit, c])).values())
        const letraBd = (parseRIT(causa.rit)?.tipo || '').toUpperCase()
        const propia = canonUnicos.find(c => c.letra === letraBd)
        const hermanos = canonUnicos.filter(c => c.letra !== letraBd)

        if (propia && hermanos.length > 0) {
          // Caso típico P↔X: la causa de la BD ES correcta (su letra está en el portal).
          // NO la tocamos. Creamos las hermanas que falten y vinculamos con una señal.
          relacionadas++
          status.exitosas++ // la causa quedó validada (su letra existe en el portal)
          log('success', `  🔗 ${causa.rit}: correcta. Hermana(s) en el portal: ${hermanos.map(h => h.rit).join(', ')}.`)
          for (const h of hermanos) {
            const tipoH = inferirTipoRIT(h.rit)
            // La hermana se crea sin caratulado (no lo tenemos aquí; el bot normal lo
            // completará al scrapearla). No inventamos datos.
            const { id: idH, creada } = await upsertCausaHermana(h.rit, tipoH, null)
            const rel = describeVinculo(propia.rit, h.rit)
            await vincularCausaEnNotas(causa.id, h.rit, rel)
            if (idH) {
              await vincularCausaEnNotas(idH, propia.rit, rel)
            } else {
              // No se pudo crear/ubicar la hermana → el vínculo en la causa BD quedaría
              // apuntando a un rit inexistente. Marcar para revisión honesta.
              await marcarRevisionLetra(causa.id, `no se pudo crear/ubicar la hermana ${h.rit}; verificar manualmente.`)
            }
            log(creada ? 'success' : 'info', creada ? `     + creada hermana ${h.rit} y vinculada.` : `     ↔ hermana ${h.rit} ya existía; vinculada.`)
          }
        } else {
          // La letra de la BD NO está entre las del portal (o no hay letra propia):
          // ambiguo de verdad. NO adivinar: marcar para revisión humana.
          ambiguas++
          status.fallidas++ // no resuelto automáticamente: queda para revisión humana
          const detalle = `número ${ritSinLetra} tiene varias letras en el portal: ${canonUnicos.map(c => c.rit).join(', ')}, y ninguna coincide con la letra actual (${letraBd || 'sin letra'}). Confirmar manualmente.`
          await marcarRevisionLetra(causa.id, detalle)
          log('warn', `  ⚠️ ${causa.rit}: AMBIGUO → marcada para revisión (${canonUnicos.map(c => c.rit).join(', ')}).`)
        }
      } else if (encontradas.length === 0) {
        noEncontradas++
        status.fallidas++
        log('warn', `  ${causa.rit}: no encontrada en el portal (se deja igual).`)
      } else {
        // Letra REAL del portal. OJO: encontradas[0].rit viene CRUDO de la celda del portal
        // y puede no estar en forma canónica (ej. "P4596-2024" sin guion, o "P-04596-2024"
        // con ceros a la izquierda). Si escribiéramos eso tal cual, "corregiríamos" una causa
        // buena a una forma malformada y inferirTipoRIT devolvería null. Por eso RENORMALIZAMOS
        // reparseando y recomponiendo a "LETRA-NUMERO-AÑO" antes de comparar/inferir/escribir.
        const parsedReal = parseRIT(encontradas[0].rit)
        if (!parsedReal) {
          noEncontradas++
          status.fallidas++
          log('warn', `  ${causa.rit}: el portal devolvió un RIT no parseable ("${encontradas[0].rit}"); se deja igual.`)
          await navigateToConsulta(page)
          await sleep(1500)
          await humanDelay(cfg.delayMin, cfg.delayMax)
          continue
        }
        // Recomponer sin ceros a la izquierda en el número (parseInt), para que
        // "P-04596-2024" y "P-4596-2024" se traten como el MISMO RIT canónico.
        const numeroCanon = String(parseInt(parsedReal.numero, 10))
        const ritReal = parsedReal.tipo
          ? `${parsedReal.tipo}-${numeroCanon}-${parsedReal.año}`
          : `${numeroCanon}-${parsedReal.año}`
        const tipoReal = inferirTipoRIT(ritReal)
        const tipoActual = causa.tipo
        // Comparar contra la forma canónica del RIT en BD también (por si viniera con
        // ceros/guion raros), reparseándolo igual. Si no parsea, comparamos crudo.
        const parsedBd = parseRIT(causa.rit)
        const ritBdCanon = parsedBd
          ? (parsedBd.tipo
              ? `${parsedBd.tipo}-${String(parseInt(parsedBd.numero, 10))}-${parsedBd.año}`
              : `${String(parseInt(parsedBd.numero, 10))}-${parsedBd.año}`)
          : causa.rit
        // "Tiene letra" = el rit trae prefijo O la columna tipo está seteada. Usar AMBAS
        // fuentes evita reetiquetar una fila que la BD ya consideraba tipada (ej. tipo='P'
        // con rit sin prefijo): esa causa NO debe entrar a la rama de escritura directa.
        const letraBd = ((parsedBd?.tipo || '') || (tipoActual || '')).toUpperCase()
        if (ritReal === ritBdCanon && tipoReal === tipoActual) {
          confirmadas++
          // En este modo, "confirmada" (la letra ya era correcta) ES un resultado exitoso:
          // el portal validó el dato. Contarlo como éxito evita que una corrida sana de
          // mantenimiento (todo ya correcto) reporte tasa_exito=0% y contamine el promedio
          // del motor de aprendizaje (que promedia bot_runs.tasa_exito).
          status.exitosas++
          log('info', `  ✓ ${causa.rit}: letra confirmada (sin cambios).`)
        } else if (!letraBd) {
          // CASO SEGURO: la causa NO tenía letra (tipo null, ej. "4596-2024" del Excel).
          // El portal devolvió UNA sola letra → se la ASIGNAMOS (no pisamos ninguna letra
          // previa; solo rellenamos la que faltaba). Este es el uso principal y sin riesgo.
          const res = await updateCausaRitYTipo(causa.id, ritReal, tipoReal)
          if (res === 'actualizado') {
            corregidas++
            status.exitosas++
            log('success', `  ✏️ ${causa.rit} → ${ritReal} (asignada letra ${tipoReal ?? '?'} que faltaba).`)
          } else if (res === 'colision_rit') {
            colisiones++
            status.fallidas++ // no resuelto automáticamente: queda para revisión humana
            const detalle = `el portal dice que el RIT real es ${ritReal}, pero ese RIT ya existe en otra causa de la BD. Revisar posible duplicado.`
            await marcarRevisionLetra(causa.id, detalle)
            log('warn', `  ⚠️ ${causa.rit}: colisión con ${ritReal} (ya existe) → marcada para revisión.`)
          } else {
            status.fallidas++
            log('warn', `  ${causa.rit}: no se pudo actualizar (error de BD).`)
          }
        } else {
          // CASO DELICADO: la causa YA tenía letra (ej. P) y el portal muestra OTRA (ej. X),
          // pero SIN la letra original en los resultados. NO pisamos: la P podría estar
          // archivada (no aparece en "Mis Causas") mientras su cumplimiento X sí. Pisar
          // borraría la protección original (bug real que ya nos pasó). Marcamos para
          // revisión + creamos la hermana + vinculamos, conservando ambas.
          relacionadas++
          status.exitosas++
          const tipoH = inferirTipoRIT(ritReal)
          const { id: idH, creada } = await upsertCausaHermana(ritReal, tipoH, null)
          const rel = describeVinculo(ritBdCanon, ritReal)
          await vincularCausaEnNotas(causa.id, ritReal, rel)
          if (idH) await vincularCausaEnNotas(idH, ritBdCanon, rel)
          await marcarRevisionLetra(causa.id, `el portal muestra ${ritReal} (no ${ritBdCanon}). Se conservó ${ritBdCanon} y se ${creada ? 'creó' : 'vinculó'} ${ritReal}. Verificar relación.`)
          log('warn', `  🔗 ${causa.rit}: el portal muestra ${ritReal}. Se CONSERVA ${ritBdCanon} y se ${creada ? 'crea' : 'vincula'} ${ritReal} (no se pisa).`)
        }
      }

      await navigateToConsulta(page)
      await sleep(1500)
    } catch (err: any) {
      status.fallidas++
      status.errores.push(`${causa.rit}: ${err.message}`)
      log('warn', `  Error revisando ${causa.rit}: ${err.message}`)
      if (categorizarError(err?.message) === 'captcha') status.bloqueo_detectado = true
      try { await navigateToConsulta(page); await sleep(1500) } catch {}
    }

    await humanDelay(cfg.delayMin, cfg.delayMax)
  }

  log('info', `━━━ FIX_LETRAS resumen: ${corregidas} corregidas, ${confirmadas} confirmadas, ${relacionadas} relacionadas (P↔X), ${ambiguas} ambiguas (marcadas), ${colisiones} colisiones (marcadas), ${noEncontradas} no encontradas ━━━`)
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
