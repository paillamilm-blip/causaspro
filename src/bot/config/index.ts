import type { BotConfig } from '../types'

// ============================================================
// CAUSASPRO BOT - Configuration
// Anti-detección: comportamiento humano simulado
// ============================================================

/** Configuración por defecto del bot */
export const DEFAULT_CONFIG: BotConfig = {
  // MODO PRIMERA CARGA: 200 causas por sesión
  maxCausasPorSesion: 200,
  
  // Delays reducidos para primera carga (10-25 segundos)
  delayMin: 10000,       // 10 segundos mínimo entre consultas
  delayMax: 25000,       // 25 segundos máximo entre consultas
  delayPostLogin: 3000,  // 3 segundos después del login
  
  // Timeouts
  navigationTimeout: 60000,  // 60 segundos para cargar página
  selectorTimeout: 15000,    // 15 segundos para encontrar elementos
  
  // Debug
  screenshotOnError: true,
  headless: true,
  
  // Fingerprint: simular un navegador real
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 768 },
  
  // Priorización
  priorizarUrgentes: true,
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

/** Horarios permitidos para ejecutar el bot (anti-detección) */
export const ALLOWED_HOURS = {
  // Solo ejecutar en horario laboral chileno (simula uso normal)
  start: 8,   // 8 AM Chile
  end: 18,    // 6 PM Chile  
  timezone: 'America/Santiago',
} as const
