import type { BotConfig } from '../types'

// ============================================================
// CAUSASPRO BOT - Configuration
// Anti-detección: comportamiento humano simulado
// ============================================================

/** Configuración por defecto del bot */
export const DEFAULT_CONFIG: BotConfig = {
  // MODO PRODUCCIÓN: 100 causas, invisible
  maxCausasPorSesion: 100,
  
  // Max detalles por sesión (antes estaba hardcodeado a 10)
  maxDetailsPorSesion: 50,
  
  // Delays producción
  delayMin: 10000,
  delayMax: 25000,
  delayPostLogin: 3000,
  
  // Timeouts
  navigationTimeout: 60000,  // 60 segundos para cargar página
  selectorTimeout: 15000,    // 15 segundos para encontrar elementos
  
  // Debug
  screenshotOnError: true,
  headless: true,  // Invisible (producción)
  
  // Fingerprint: simular un navegador real
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 768 },
  
  // Priorización
  priorizarUrgentes: true,
  
  // Años a buscar en el portal
  years: ['2026', '2025', '2024'],
}

/** URLs del portal OJV */
export const OJV_URLS = {
  home: 'https://oficinajudicialvirtual.pjud.cl/home/index.php',
  login: 'https://oficinajudicialvirtual.pjud.cl/home/index.php',
  misCausas: 'https://oficinajudicialvirtual.pjud.cl/ADIR_871/mis_causas.php',
  consultaCausas: 'https://oficinajudicialvirtual.pjud.cl/ADIR_871/consulta_causas.php',
  busquedaRIT: 'https://oficinajudicialvirtual.pjud.cl/indexN.php',
} as const

/** Selectores CSS del portal (se actualizan si el portal cambia) */
export const OJV_SELECTORS = {
  // Login
  loginForm: '#loginForm, form[name="loginForm"], form[action*="login"]',
  rutInput: '#uname, input[name="uname"], input[name="rut"], #rutInput',
  passwordInput: '#pword, input[name="pword"], input[name="password"], #passInput',
  loginButton: '#loginButton, input[type="submit"], button[type="submit"]',
  loginError: '.error-message, .alert-danger, .msg-error',
  // Navegación post-login
  menuConsultas: 'a[href*="consulta"], a:has-text("Consulta")',
  menuMisCausas: 'a[href*="mis_causas"], a:has-text("Mis Causas")',
  
  // Búsqueda por RIT
  searchRITInput: '#rit, input[name="rit"], input[placeholder*="RIT"]',
  searchTribunalSelect: 'select[name="tribunal"], #tribunal',
  searchButton: '#btnBuscar, button:has-text("Buscar"), input[value="Buscar"]',
  searchResults: '.resultado, .tabla-causas, table.causas, #resultados',
  searchResultRow: 'tr.causa, .resultado-causa, table tbody tr',
  
  // Detalle de causa
  causaLink: 'a[href*="causa"], a[href*="detalle"]',
  tabMovimientos: 'a[href*="movimiento"], a:has-text("Historial"), a:has-text("Tramitación"), li:has-text("Historial")',
  tabAudiencias: 'a[href*="audiencia"], a:has-text("Audiencia"), li:has-text("Audiencia")',
  tabResoluciones: 'a[href*="resolucion"], a:has-text("Resoluc"), li:has-text("Resoluc")',
  
  // Tabla de movimientos
  movimientosTable: 'table.movimientos, #tablaMovimientos, table:has(th:has-text("Trámite"))',
  movimientoRow: 'tbody tr',
  movimientoFecha: 'td:nth-child(1)',
  movimientoEtapa: 'td:nth-child(2)',
  movimientoTramite: 'td:nth-child(3)',
  movimientoDesc: 'td:nth-child(4)',
  
  // Tabla de audiencias
  audienciasTable: 'table.audiencias, #tablaAudiencias, table:has(th:has-text("Audiencia"))',
  audienciaRow: 'tbody tr',
  audienciaFecha: 'td:nth-child(1)',
  audienciaTipo: 'td:nth-child(2)',
  audienciaSala: 'td:nth-child(3)',
  audienciaEstado: 'td:nth-child(4)',
  
  // Estado actual
  estadoCausa: '.estado-causa, span:has-text("Estado"), .info-causa .estado',
  
  // Anti-bot detection
  captcha: '.captcha, #captcha, .g-recaptcha, [class*="captcha"]',
  blocked: '.blocked, .access-denied, :has-text("acceso denegado")',
} as const

/** Patrones de texto para detectar urgencia */
export const URGENCY_PATTERNS = {
  trasladoCurador: [
    'TRASLADO AL CURADOR',
    'TRASLADO CURADOR AD LITEM',
    'TRASLADO CURADOR',
    'TRASL. CURADOR',
  ],
  audienciaUrgente: [
    'AUDIENCIA PREPARATORIA',
    'AUDIENCIA DE JUICIO',
    'AUDIENCIA CAUTELAR',
  ],
  plazoFatal: [
    'PLAZO FATAL',
    'APERCIBIMIENTO',
    'ÚLTIMO PLAZO',
  ],
} as const

/**
 * Horarios permitidos para ejecutar el bot (anti-detección).
 *
 * Se pueden cambiar SIN tocar este archivo: BOT_HORA_INICIO y BOT_HORA_FIN en el .bat,
 * igual que BOT_MAX_CAUSAS. Un valor inválido (vacío, letra, fuera de 0-23) no rompe el
 * arranque: se ignora y queda el default.
 */
const horaDelEnv = (valor: string | undefined, porDefecto: number): number => {
  const n = parseInt(valor ?? '', 10)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : porDefecto
}

export const ALLOWED_HOURS = {
  start: horaDelEnv(process.env.BOT_HORA_INICIO, 6),   // 6 AM Chile
  end: horaDelEnv(process.env.BOT_HORA_FIN, 18),       // 6 PM Chile
  timezone: 'America/Santiago',
} as const

/** Ventana horaria en minutos desde medianoche (hora Chile). */
export type VentanaHoraria = { inicio: number; fin: number }

/**
 * Varias ventanas horarias con precisión de minutos, p. ej.
 * BOT_HORARIOS=06:00-08:30,13:30-17:00,18:00-20:00
 * Si la variable no está o es inválida, se usa la ventana única de ALLOWED_HOURS.
 */
const parseHorarios = (valor: string | undefined): VentanaHoraria[] | null => {
  if (!valor || !valor.trim()) return null
  const ventanas: VentanaHoraria[] = []
  for (const parte of valor.split(',')) {
    const m = parte.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const [h1, m1, h2, m2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null
    const inicio = h1 * 60 + m1
    const fin = h2 * 60 + m2
    if (fin <= inicio) return null
    ventanas.push({ inicio, fin })
  }
  return ventanas.length > 0 ? ventanas : null
}

export const ALLOWED_WINDOWS: VentanaHoraria[] =
  parseHorarios(process.env.BOT_HORARIOS) ??
  [{ inicio: ALLOWED_HOURS.start * 60, fin: ALLOWED_HOURS.end * 60 }]
