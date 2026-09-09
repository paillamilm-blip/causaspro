// ============================================================
// CAUSASPRO BOT - Utilities
// ============================================================

import { ALLOWED_HOURS } from '../config'
import type { BotErrorType } from '../types'

/**
 * Genera un delay aleatorio entre min y max (milisegundos)
 * Simula comportamiento humano con distribución no uniforme
 */
export function randomDelay(min: number, max: number): number {
  // Distribución que favorece delays medios (más natural)
  const random = Math.random() * Math.random() // Sesgo hacia valores bajos
  const base = min + (max - min) * (0.3 + random * 0.7) // 30% base + random
  // Añadir micro-variación
  const jitter = (Math.random() - 0.5) * 2000
  return Math.max(min, Math.round(base + jitter))
}

/**
 * Sleep con delay aleatorio
 */
export async function humanDelay(min: number, max: number): Promise<void> {
  const delay = randomDelay(min, max)
  console.log(`  ⏳ Esperando ${(delay / 1000).toFixed(1)}s...`)
  return new Promise(resolve => setTimeout(resolve, delay))
}

/**
 * Sleep fijo
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Verifica si estamos en horario permitido (Chile)
 */
export function isWithinAllowedHours(): boolean {
  const now = new Date()
  const chileTime = new Date(now.toLocaleString('en-US', { timeZone: ALLOWED_HOURS.timezone }))
  const hour = chileTime.getHours()
  return hour >= ALLOWED_HOURS.start && hour < ALLOWED_HOURS.end
}

/**
 * Formatea RUT chileno para input del portal
 * Acepta: "12345678-9", "12.345.678-9", "123456789"
 * Retorna formato limpio: "12345678-9"
 */
export function formatRut(rut: string): string {
  // Quitar puntos y espacios
  let clean = rut.replace(/\./g, '').replace(/\s/g, '').trim()
  
  // Si no tiene guión, agregarlo antes del último carácter
  if (!clean.includes('-') && clean.length > 1) {
    clean = clean.slice(0, -1) + '-' + clean.slice(-1)
  }
  
  return clean
}

/**
 * Parsea fecha del portal PJUD
 * Formatos posibles: "12/03/2024", "12-03-2024", "12/03/2024 10:30"
 */
export function parsePJUDDate(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null
  
  const clean = dateStr.trim()
  
  // Formato: dd/mm/yyyy o dd-mm-yyyy (con hora opcional)
  const match = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (match) {
    const [, day, month, year, hour, minute] = match
    const d = Number(day), m = Number(month), y = Number(year)
    
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2000 && y <= 2030) {
      if (hour && minute) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}:00`
      }
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  
  // Formato ISO ya viene correcto
  if (clean.match(/^\d{4}-\d{2}-\d{2}/)) {
    return clean.split('T')[0]
  }
  
  return null
}

/**
 * Limpia texto extraído del HTML
 */
export function cleanText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim()
}

/**
 * Genera un ID de sesión único para tracking
 */
export function generateRunId(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const time = now.toISOString().slice(11, 16).replace(/:/g, '')
  const rand = Math.random().toString(36).slice(2, 6)
  return `run_${date}_${time}_${rand}`
}

/**
 * Log con timestamp
 */
export function log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
  const timestamp = new Date().toLocaleTimeString('es-CL', { timeZone: 'America/Santiago' })
  const icons = { info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅' }
  console.log(`[${timestamp}] ${icons[level]} ${message}`)
}

/**
 * Detecta si un texto contiene patrones de "TRASLADO AL CURADOR"
 */
export function detectTrasladoCurador(text: string): boolean {
  const upper = text.toUpperCase()
  const patterns = [
    'TRASLADO AL CURADOR',
    'TRASLADO CURADOR AD LITEM',
    'TRASLADO CURADOR',
    'TRASL. CURADOR',
    'TRASL CURADOR',
  ]
  return patterns.some(p => upper.includes(p))
}

/**
 * Prefijos de RIT válidos para la columna `causas.tipo`.
 * FUENTE ÚNICA DE VERDAD: debe coincidir con el CHECK constraint de
 * schema.sql / schema-tipo-fix.sql. Si se agrega un prefijo aquí, hay que
 * ampliar también el CHECK en la BD (y viceversa).
 *   P=Protección, C=Cumplimiento, F=Ordinario/Familia, V=Violencia intrafamiliar,
 *   X=Exhortos/varios, Z=Otros, T=Tutela, FA=multi-letra, RIT genérico.
 */
export const TIPOS_RIT_VALIDOS = ['P', 'C', 'F', 'V', 'X', 'Z', 'T', 'FA', 'RIT'] as const

/**
 * Parsea RIT del portal PJUD.
 * Soporta prefijos de 1 a 3 letras: "P-123-2024", "C-456-2024", "FA-78-2025".
 * (El regex de búsqueda de search.ts es más laxo — ^[A-Z]{0,3}-?\d+-\d{4}$ —
 *  acepta RITs sin prefijo; aquí exigimos al menos una letra para poder derivar tipo.)
 */
export function parseRIT(rit: string): { tipo: string; numero: string; año: string } | null {
  const match = rit.trim().match(/^([A-Z]{1,3})-(\d+)-(\d{4})$/i)
  if (!match) return null
  return { tipo: match[1].toUpperCase(), numero: match[2], año: match[3] }
}

/**
 * Deriva el `tipo` de causa desde el RIT, VALIDANDO contra la lista blanca
 * permitida por el CHECK de la BD. Retorna null si el RIT no parsea o si el
 * prefijo no está permitido (evita violar el constraint causas_tipo_check).
 * Usar siempre esto antes de escribir `tipo` en la tabla `causas`.
 */
export function inferirTipoRIT(rit: string): string | null {
  const parsed = parseRIT(rit)
  if (!parsed) return null
  return (TIPOS_RIT_VALIDOS as readonly string[]).includes(parsed.tipo) ? parsed.tipo : null
}

/**
 * Categoriza un error en un tipo conocido (BotErrorType) a partir de su mensaje.
 * Esto convierte texto libre en una etiqueta agrupable, para que el motor de
 * aprendizaje pueda contar "cuántos timeouts", "cuántos captcha", etc.
 * No hace nada "inteligente": solo busca palabras clave.
 */
export function categorizarError(mensaje: string | undefined | null): BotErrorType {
  const m = (mensaje || '').toLowerCase()
  if (!m) return 'desconocido'
  if (m.includes('captcha') || m.includes('recaptcha') || m.includes('denegado') || m.includes('blocked')) return 'captcha'
  if (m.includes('timeout') || m.includes('timed out') || m.includes('exceeded')) return 'timeout'
  if (m.includes('no encontrada') || m.includes('not found') || m.includes('sin resultados') || m.includes('0 resultado')) return 'no_encontrada'
  if (m.includes('navega') || m.includes('navigation') || m.includes('net::') || m.includes('goto')) return 'navegacion'
  if (m.includes('sesión') || m.includes('sesion') || m.includes('session') || m.includes('login') || m.includes('logout')) return 'sesion'
  if (m.includes('parse') || m.includes('undefined') || m.includes('null') || m.includes('cannot read')) return 'parseo'
  return 'desconocido'
}

/**
 * Retry con backoff exponencial
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 5000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt === maxRetries) throw error
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 2000
      log('warn', `Reintentando en ${(delay/1000).toFixed(1)}s (intento ${attempt + 1}/${maxRetries})...`)
      await sleep(delay)
    }
  }
  throw new Error('Max retries exceeded')
}
