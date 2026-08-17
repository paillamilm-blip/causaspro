// ============================================================
// CAUSASPRO BOT - Login Module
// Maneja autenticación en Oficina Judicial Virtual (OJV)
// ============================================================

import type { Page, Browser, BrowserContext } from 'playwright'
import type { OJVCredentials, LoginResult } from '../types'
import { OJV_URLS, OJV_SELECTORS, DEFAULT_CONFIG } from '../config'
import { formatRut, humanDelay, sleep, log } from '../utils'

/**
 * Crea un contexto de navegador con fingerprint realista
 * Anti-detección: simula un usuario real de Chrome en Windows
 */
export async function createStealthContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: DEFAULT_CONFIG.userAgent,
    viewport: DEFAULT_CONFIG.viewport,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    
    // Simular permisos de un navegador real
    permissions: ['geolocation'],
    geolocation: { latitude: -33.4489, longitude: -70.6693 }, // Santiago, Chile
    
    // Headers extras para parecer más real
    extraHTTPHeaders: {
      'Accept-Language': 'es-CL,es;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
    
    // Ignorar errores HTTPS (portal a veces tiene certificados con issues)
    ignoreHTTPSErrors: true,
  })

  // Anti-detección: inyectar scripts para ocultar automatización
  await context.addInitScript(() => {
    // Ocultar webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    
    // Chrome runtime fake
    // @ts-ignore
    window.chrome = { runtime: {} }
    
    // Plugins fake (navegador real tiene plugins)
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5] // Simula 5 plugins
    })
    
    // Languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['es-CL', 'es', 'en-US', 'en']
    })
    
    // Platform
    Object.defineProperty(navigator, 'platform', {
      get: () => 'Win32'
    })
  })

  return context
}

/**
 * Login en la Oficina Judicial Virtual
 * Intenta login con credenciales del portal PJUD (no ClaveÚnica)
 */
export async function loginOJV(page: Page, credentials: OJVCredentials): Promise<LoginResult> {
  log('info', 'Iniciando login en Oficina Judicial Virtual...')
  
  try {
    // 1. Navegar al portal
    await page.goto(OJV_URLS.login, { 
      waitUntil: 'networkidle',
      timeout: DEFAULT_CONFIG.navigationTimeout 
    })
    
    // Esperar un momento (comportamiento humano)
    await sleep(2000 + Math.random() * 2000)
    
    // 2. Verificar si hay captcha
    const captchaElement = await page.$(OJV_SELECTORS.captcha)
    if (captchaElement) {
      log('error', 'CAPTCHA detectado en login - no se puede proceder automáticamente')
      return { success: false, error: 'CAPTCHA detectado. Requiere intervención manual.' }
    }
    
    // 3. Verificar si estamos bloqueados
    const blockedElement = await page.$(OJV_SELECTORS.blocked)
    if (blockedElement) {
      log('error', 'Acceso bloqueado por el portal')
      return { success: false, error: 'Acceso bloqueado. Esperar e intentar más tarde.' }
    }
    
    // 4. Buscar formulario de login
    // El portal puede tener varios formatos de login, intentamos varios selectores
    const rutInput = await findElement(page, [
      '#uname',
      'input[name="uname"]', 
      'input[name="rut"]',
      '#rutInput',
      'input[placeholder*="RUT"]',
      'input[placeholder*="rut"]',
      'input[type="text"]:first-of-type',
    ])
    
    if (!rutInput) {
      // Tal vez hay un botón para ir al login primero
      const loginLink = await page.$('a:has-text("Iniciar"), a:has-text("Ingresar"), button:has-text("Ingresar")')
      if (loginLink) {
        await loginLink.click()
        await page.waitForLoadState('networkidle')
        await sleep(2000)
      }
    }

    // Reintentar encontrar el input de RUT
    const rutField = rutInput || await findElement(page, [
      '#uname',
      'input[name="uname"]', 
      'input[name="rut"]',
      '#rutInput',
      'input[placeholder*="RUT"]',
      'input[type="text"]',
    ])

    if (!rutField) {
      log('error', 'No se encontró campo de RUT en el formulario de login')
      return { success: false, error: 'Campo de RUT no encontrado. El portal puede haber cambiado.' }
    }
    
    // 5. Escribir RUT (simulando tipeo humano)
    const formattedRut = formatRut(credentials.rut)
    await rutField.click()
    await sleep(300 + Math.random() * 500)
    await typeHumanLike(page, rutField, formattedRut)
    
    // 6. Tab al password (comportamiento humano)
    await sleep(500 + Math.random() * 800)
    
    const passwordField = await findElement(page, [
      '#pword',
      'input[name="pword"]',
      'input[name="password"]',
      '#passInput',
      'input[type="password"]',
    ])
    
    if (!passwordField) {
      log('error', 'No se encontró campo de contraseña')
      return { success: false, error: 'Campo de contraseña no encontrado.' }
    }
    
    await passwordField.click()
    await sleep(300 + Math.random() * 400)
    await typeHumanLike(page, passwordField, credentials.password)
    
    // 7. Esperar un momento antes de submit (humano)
    await sleep(800 + Math.random() * 1200)
    
    // 8. Submit
    const submitButton = await findElement(page, [
      '#loginButton',
      'input[type="submit"]',
      'button[type="submit"]',
      'button:has-text("Ingresar")',
      'button:has-text("Entrar")',
      'input[value="Ingresar"]',
      'input[value="Entrar"]',
    ])
    
    if (submitButton) {
      await submitButton.click()
    } else {
      // Fallback: Enter en el campo de password
      await page.keyboard.press('Enter')
    }
    
    // 9. Esperar respuesta
    await page.waitForLoadState('networkidle', { timeout: DEFAULT_CONFIG.navigationTimeout })
    await sleep(2000)
    
    // 10. Verificar si el login fue exitoso
    const loginSuccess = await verifyLoginSuccess(page)
    
    if (loginSuccess) {
      log('success', 'Login exitoso en OJV')
      // Delay post-login (anti-detección)
      await humanDelay(3000, DEFAULT_CONFIG.delayPostLogin)
      return { success: true }
    }
    
    // Verificar mensajes de error
    const errorMsg = await getErrorMessage(page)
    log('error', `Login fallido: ${errorMsg}`)
    return { success: false, error: errorMsg }
    
  } catch (error: any) {
    log('error', `Error durante login: ${error.message}`)
    return { success: false, error: error.message }
  }
}

/**
 * Verifica si estamos logueados correctamente
 */
async function verifyLoginSuccess(page: Page): Promise<boolean> {
  // Indicadores de login exitoso:
  const successIndicators = [
    'a:has-text("Cerrar Sesión")',
    'a:has-text("Salir")',
    'a:has-text("Mi Perfil")',
    '.usuario-logueado',
    '#userMenu',
    'a[href*="logout"]',
    'a[href*="cerrar"]',
    ':has-text("Bienvenido")',
    'a:has-text("Mis Causas")',
  ]
  
  for (const selector of successIndicators) {
    try {
      const element = await page.$(selector)
      if (element) return true
    } catch {}
  }
  
  // También verificar la URL (si cambió del login)
  const currentUrl = page.url()
  if (!currentUrl.includes('login') && !currentUrl.includes('index.php')) {
    return true
  }
  
  return false
}

/**
 * Extrae mensaje de error del formulario
 */
async function getErrorMessage(page: Page): Promise<string> {
  const errorSelectors = [
    '.error-message',
    '.alert-danger',
    '.msg-error',
    '.error',
    '#errorMsg',
    'p.text-danger',
    'span.error',
  ]
  
  for (const selector of errorSelectors) {
    try {
      const element = await page.$(selector)
      if (element) {
        const text = await element.textContent()
        if (text?.trim()) return text.trim()
      }
    } catch {}
  }
  
  return 'Credenciales incorrectas o error desconocido'
}

/**
 * Encuentra el primer elemento que coincida con alguno de los selectores
 */
async function findElement(page: Page, selectors: string[]): Promise<any | null> {
  for (const selector of selectors) {
    try {
      const element = await page.$(selector)
      if (element) {
        const isVisible = await element.isVisible()
        if (isVisible) return element
      }
    } catch {}
  }
  return null
}

/**
 * Simula tipeo humano con velocidad variable
 * Anti-detección: no escribe todo de golpe
 */
async function typeHumanLike(page: Page, element: any, text: string): Promise<void> {
  // Limpiar campo primero
  await element.fill('')
  await sleep(100)
  
  // Escribir carácter por carácter con delay variable
  for (const char of text) {
    await element.type(char, { delay: 50 + Math.random() * 150 })
    
    // Pausa más larga ocasional (simula pensar)
    if (Math.random() < 0.1) {
      await sleep(200 + Math.random() * 400)
    }
  }
}

/**
 * Verifica si la sesión sigue activa
 */
export async function isSessionActive(page: Page): Promise<boolean> {
  try {
    const logoutLink = await page.$('a[href*="logout"], a:has-text("Cerrar Sesión"), a:has-text("Salir")')
    return logoutLink !== null
  } catch {
    return false
  }
}

/**
 * Logout limpio de la sesión
 */
export async function logoutOJV(page: Page): Promise<void> {
  try {
    log('info', 'Cerrando sesión en OJV...')
    const logoutLink = await page.$('a[href*="logout"], a:has-text("Cerrar Sesión"), a:has-text("Salir")')
    if (logoutLink) {
      await logoutLink.click()
      await page.waitForLoadState('networkidle')
    }
    log('success', 'Sesión cerrada correctamente')
  } catch (error: any) {
    log('warn', `Error al cerrar sesión: ${error.message}`)
  }
}
