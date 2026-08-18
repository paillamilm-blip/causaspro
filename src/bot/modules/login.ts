// ============================================================
// CAUSASPRO BOT - Login Module
// Login via Clave Única en Oficina Judicial Virtual (OJV)
// Flujo: OJV → Click "Clave Única" → accounts.claveunica.gob.cl → RUN + Pass
// ============================================================

import type { Page, Browser, BrowserContext } from 'playwright'
import type { OJVCredentials, LoginResult } from '../types'
import { OJV_URLS, DEFAULT_CONFIG } from '../config'
import { sleep, log } from '../utils'

/**
 * Crea un contexto de navegador con fingerprint realista
 */
export async function createStealthContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: DEFAULT_CONFIG.userAgent,
    viewport: DEFAULT_CONFIG.viewport,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    permissions: ['geolocation'],
    geolocation: { latitude: -33.4489, longitude: -70.6693 },
    extraHTTPHeaders: {
      'Accept-Language': 'es-CL,es;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    ignoreHTTPSErrors: true,
  })

  // Anti-detección
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    // @ts-ignore
    window.chrome = { runtime: {} }
    Object.defineProperty(navigator, 'languages', { get: () => ['es-CL', 'es', 'en'] })
  })

  return context
}

/**
 * Login en OJV via Clave Única
 * Flujo:
 * 1. Ir a oficinajudicialvirtual.pjud.cl
 * 2. Click en "Clave Única" 
 * 3. Redirige a accounts.claveunica.gob.cl
 * 4. Ingresar RUN + contraseña
 * 5. Vuelve al portal logueado
 */
export async function loginOJV(page: Page, credentials: OJVCredentials): Promise<LoginResult> {
  log('info', 'Iniciando login en OJV via Clave Única...')
  
  try {
    // PASO 1: Ir al portal OJV
    log('info', '  Navegando a oficinajudicialvirtual.pjud.cl...')
    await page.goto(OJV_URLS.home, { 
      waitUntil: 'domcontentloaded',
      timeout: 90000 
    })
    // Esperar un poco más por si carga lento
    await sleep(5000)
    
    // PASO 1.5: Cerrar CUALQUIER popup/modal/aviso que aparezca
    log('info', '  Cerrando avisos del portal...')
    // Esperar a que los modales carguen
    await sleep(3000)
    
    // Método 1: Eliminar TODOS los modales con JavaScript
    await page.evaluate(() => {
      // Eliminar todos los modales
      document.querySelectorAll('.modal, .modal-backdrop, [role="dialog"]').forEach(el => {
        (el as HTMLElement).style.display = 'none';
        el.remove();
      });
      // Limpiar body
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      document.body.style.removeProperty('overflow');
    }).catch(() => {})
    
    await sleep(1000)
    
    // Método 2: Si jQuery/Bootstrap está disponible, cerrar modales
    await page.evaluate(() => {
      try {
        // @ts-ignore
        if (window.$ || window.jQuery) {
          // @ts-ignore
          (window.$ || window.jQuery)('.modal').modal('hide');
        }
      } catch {}
    }).catch(() => {})
    
    await sleep(1000)
    log('info', '  Avisos cerrados')
    
    // PASO 2: Click en "Clave Única"
    log('info', '  Buscando botón "Clave Única"...')
    
    const claveUnicaBtn = await findClaveUnicaButton(page)
    
    if (!claveUnicaBtn) {
      log('error', 'No se encontró el botón "Clave Única" en el portal')
      // Tomar screenshot para debug
      await page.screenshot({ path: '/tmp/bot_error_no_claveunica_btn.png' }).catch(() => {})
      return { success: false, error: 'Botón "Clave Única" no encontrado en el portal. El diseño puede haber cambiado.' }
    }
    
    await sleep(1000 + Math.random() * 1000)
    await claveUnicaBtn.click()
    
    // PASO 3: Esperar redirección a accounts.claveunica.gob.cl
    log('info', '  Esperando redirección a Clave Única...')
    
    // Esperar hasta 30 segundos a que la URL cambie
    let redirected = false
    for (let i = 0; i < 15; i++) {
      await sleep(2000)
      const currentUrl = page.url()
      if (currentUrl.includes('claveunica')) {
        redirected = true
        break
      }
    }
    
    if (!redirected) {
      const finalUrl = page.url()
      log('error', `No redirigió a Clave Única. URL actual: ${finalUrl}`)
      await page.screenshot({ path: '/tmp/bot_error_no_redirect.png' }).catch(() => {})
      return { success: false, error: 'No se redirigió a Clave Única' }
    }
    
    await page.waitForLoadState('domcontentloaded')
    await sleep(2000 + Math.random() * 2000)
    
    log('info', '  En página de Clave Única...')
    
    // PASO 4: Ingresar RUN
    log('info', '  Ingresando RUN...')
    
    const runInput = await findRunInput(page)
    if (!runInput) {
      log('error', 'No se encontró campo de RUN en Clave Única')
      await page.screenshot({ path: '/tmp/bot_error_no_run_field.png' }).catch(() => {})
      return { success: false, error: 'Campo RUN no encontrado en Clave Única' }
    }
    
    // Formatear RUN (sin puntos, con guión)
    const runFormatted = formatRun(credentials.rut)
    
    await runInput.click()
    await sleep(500)
    await runInput.fill('')
    await sleep(300)
    
    // Escribir RUN carácter por carácter
    for (const char of runFormatted) {
      await runInput.type(char, { delay: 80 + Math.random() * 120 })
    }
    
    await sleep(1000 + Math.random() * 1000)
    
    // PASO 5: Click en continuar/siguiente (si hay paso intermedio)
    const continueBtn = await page.$('button:has-text("Continuar"), button:has-text("Siguiente"), input[type="submit"]')
    if (continueBtn) {
      await continueBtn.click()
      await page.waitForLoadState('domcontentloaded')
      await sleep(2000)
    }
    
    // PASO 6: Ingresar contraseña
    log('info', '  Ingresando contraseña...')
    
    const passwordInput = await findPasswordInput(page)
    if (!passwordInput) {
      // Puede ser que RUN y password estén en la misma página
      log('error', 'No se encontró campo de contraseña')
      await page.screenshot({ path: '/tmp/bot_error_no_pass_field.png' }).catch(() => {})
      return { success: false, error: 'Campo de contraseña no encontrado' }
    }
    
    await passwordInput.click()
    await sleep(500)
    
    // Escribir contraseña
    for (const char of credentials.password) {
      await passwordInput.type(char, { delay: 60 + Math.random() * 100 })
    }
    
    await sleep(1000 + Math.random() * 1500)
    
    // PASO 7: Click en Ingresar/Autenticar
    log('info', '  Enviando formulario...')
    
    const submitBtn = await findSubmitButton(page)
    if (submitBtn) {
      await submitBtn.click()
    } else {
      await page.keyboard.press('Enter')
    }
    
    // PASO 8: Esperar que vuelva al portal OJV
    log('info', '  Esperando autenticación...')
    
    try {
      await page.waitForURL('**pjud.cl**', { timeout: 30000 })
    } catch {
      // Verificar si hay error de login
      const errorMsg = await getLoginError(page)
      if (errorMsg) {
        log('error', `Login fallido: ${errorMsg}`)
        return { success: false, error: errorMsg }
      }
      // Puede ser que ya esté logueado
    }
    
    await page.waitForLoadState('domcontentloaded')
    await sleep(3000)
    
    // PASO 9: Verificar login exitoso
    const isLogged = await verifyLoginSuccess(page)
    
    if (isLogged) {
      log('success', '✅ Login exitoso en OJV via Clave Única')
      return { success: true }
    }
    
    // Último intento: verificar URL
    const finalUrl = page.url()
    if (finalUrl.includes('pjud.cl') && !finalUrl.includes('index.php')) {
      log('success', '✅ Login aparentemente exitoso (redirigido)')
      return { success: true }
    }
    
    log('error', `Login no confirmado. URL: ${finalUrl}`)
    await page.screenshot({ path: '/tmp/bot_error_login_unconfirmed.png' }).catch(() => {})
    return { success: false, error: 'No se pudo confirmar el login' }
    
  } catch (error: any) {
    log('error', `Error durante login: ${error.message}`)
    await page.screenshot({ path: '/tmp/bot_error_exception.png' }).catch(() => {})
    return { success: false, error: error.message }
  }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Busca el botón "Clave Única" en la página principal del portal
 */
async function findClaveUnicaButton(page: Page): Promise<any | null> {
  // Esperar que el menú cargue
  await page.waitForTimeout(2000)
  
  // Método 1: Playwright getByText (más confiable)
  try {
    const el = await page.getByText('Clave Única', { exact: false }).first()
    if (el && await el.isVisible()) return el
  } catch {}
  
  // Método 2: Selectores CSS
  const selectors = [
    'a:has-text("Clave Única")',
    'a:has-text("Clave Unica")',
    'span:has-text("Clave Única")',
    'a[href*="claveunica"]',
    'a[href*="ClaveUnica"]',
    'a[href*="autenticacion"]',
  ]
  
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el) return el
    } catch {}
  }
  
  // Método 3: Buscar en todos los links
  const allLinks = await page.$$('a')
  for (const link of allLinks) {
    try {
      const text = await link.textContent()
      if (text && text.includes('Clave') && text.includes('nica')) {
        return link
      }
    } catch {}
  }
  
  // Método 4: Buscar en CUALQUIER elemento clickeable
  const clickables = await page.$$('a, span, div, button, li')
  for (const el of clickables) {
    try {
      const text = await el.textContent()
      if (text && text.trim().includes('Clave Única')) {
        return el
      }
    } catch {}
  }
  
  return null
}

/**
 * Busca el campo de RUN en la página de Clave Única
 */
async function findRunInput(page: Page): Promise<any | null> {
  const selectors = [
    'input[name="run"]',
    'input[id="run"]',
    'input[placeholder*="RUN"]',
    'input[placeholder*="RUT"]',
    'input[placeholder*="Ingresa tu RUN"]',
    'input[name="rut"]',
    'input[id="rut"]',
    'input[type="text"]',
    '#run',
    '#rut',
  ]
  
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el && await el.isVisible()) return el
    } catch {}
  }
  return null
}

/**
 * Busca el campo de contraseña
 */
async function findPasswordInput(page: Page): Promise<any | null> {
  const selectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[name="clave"]',
    'input[id="password"]',
    'input[placeholder*="Contraseña"]',
    'input[placeholder*="Clave"]',
  ]
  
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el && await el.isVisible()) return el
    } catch {}
  }
  return null
}

/**
 * Busca el botón de submit
 */
async function findSubmitButton(page: Page): Promise<any | null> {
  const selectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Ingresar")',
    'button:has-text("Autenticar")',
    'button:has-text("Iniciar")',
    'button:has-text("Entrar")',
    'button:has-text("Acceder")',
    '#login-submit',
    '.btn-primary',
  ]
  
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el && await el.isVisible()) return el
    } catch {}
  }
  return null
}

/**
 * Formatea RUN para Clave Única (sin puntos, con guión)
 * Input: "17.692.174-9" o "17692174-9" o "176921749"
 * Output: "17692174-9"
 */
function formatRun(rut: string): string {
  let clean = rut.replace(/\./g, '').replace(/\s/g, '').trim()
  if (!clean.includes('-') && clean.length > 1) {
    clean = clean.slice(0, -1) + '-' + clean.slice(-1)
  }
  return clean
}

/**
 * Verifica si el login fue exitoso
 */
async function verifyLoginSuccess(page: Page): Promise<boolean> {
  const indicators = [
    'a:has-text("Cerrar Sesión")',
    'a:has-text("Salir")',
    'a[href*="logout"]',
    'a[href*="cerrar"]',
    ':has-text("Bienvenido")',
    'a:has-text("Mis Causas")',
    'a:has-text("Consulta")',
    '.usuario-logueado',
    '#userMenu',
  ]
  
  for (const sel of indicators) {
    try {
      const el = await page.$(sel)
      if (el) return true
    } catch {}
  }
  return false
}

/**
 * Obtiene mensaje de error de login
 */
async function getLoginError(page: Page): Promise<string | null> {
  const selectors = [
    '.error',
    '.alert-danger',
    '.msg-error',
    '.error-message',
    'p.text-danger',
    ':has-text("RUN o Clave incorrecta")',
    ':has-text("credenciales")',
    ':has-text("incorrecto")',
  ]
  
  for (const sel of selectors) {
    try {
      const el = await page.$(sel)
      if (el) {
        const text = await el.textContent()
        if (text?.trim()) return text.trim()
      }
    } catch {}
  }
  return null
}

/**
 * Verifica si la sesión sigue activa
 */
export async function isSessionActive(page: Page): Promise<boolean> {
  try {
    const el = await page.$('a[href*="logout"], a:has-text("Cerrar Sesión"), a:has-text("Salir")')
    return el !== null
  } catch {
    return false
  }
}

/**
 * Logout
 */
export async function logoutOJV(page: Page): Promise<void> {
  try {
    const logoutLink = await page.$('a[href*="logout"], a:has-text("Cerrar Sesión"), a:has-text("Salir")')
    if (logoutLink) {
      await logoutLink.click()
      await page.waitForLoadState('domcontentloaded').catch(() => {})
    }
    log('info', 'Sesión cerrada')
  } catch {}
}
