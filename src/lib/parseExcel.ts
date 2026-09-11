import * as XLSX from 'xlsx'
import { LETRAS_VALIDAS } from './materiasFamilia'

// ============================================================
// CAUSASPRO - Parser Universal de Documentos
// Carga TODAS las columnas del Excel/CSV
// Solo requiere que exista una columna con RIT
// Las columnas extras se guardan en datos_extra (JSONB)
// ============================================================

export interface CausaRaw {
  rit: string
  caratulado?: string
  tipo?: string
  fecha_apertura?: string
  sintesis?: string
  estado?: string
  programa_vigente?: string
  saj?: string
  notas?: string
  /** TODAS las columnas del Excel como JSON */
  datos_extra?: Record<string, any>
  /** Nombres originales de las columnas */
  columnas_origen?: string[]
}

export interface NnaRaw {
  _rit: string
  nombre?: string
  apellido?: string
  rut?: string
  fecha_nacimiento?: string
  edad?: number
  nacionalidad?: string
  direccion?: string
  colegio?: string
  curso?: string
  cesfam?: string
}

export interface AdultoRaw {
  _rit: string
  nombre?: string
  relacion?: string
  telefono?: string
  direccion?: string
}

export interface AudienciaRaw {
  _rit: string
  fecha?: string
}

export interface ParseResult {
  causas: CausaRaw[]
  nna: NnaRaw[]
  adultos: AdultoRaw[]
  audiencias: AudienciaRaw[]
  /** Todas las columnas detectadas del archivo */
  columnasDetectadas: string[]
  /** Hoja utilizada */
  hoja: string
  /** Total filas procesadas */
  totalFilas: number
}

// ============================================================
// LIMPIEZA
// ============================================================

function limpiarTexto(val: any, max?: number): string | undefined {
  if (val === null || val === undefined) return undefined
  const t = String(val).trim()
  if (!t || t.toLowerCase() === 'nan' || t.toLowerCase() === 'none' || t === '-' || t === 'N/A') return undefined
  return max ? t.slice(0, max) : t
}

function limpiarRut(val: any): string | undefined {
  if (!val) return undefined
  let t = String(val).trim()
  if (!t) return undefined
  t = t.replace(/\./g, '').replace(/\s/g, '')
  return t.slice(0, 30) || undefined
}

function limpiarFecha(val: any): string | undefined {
  if (!val) return undefined
  
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return undefined
    return val.toISOString().split('T')[0]
  }
  
  if (typeof val === 'number' && val > 10000) {
    const d = new Date((val - 25569) * 86400 * 1000)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }

  const t = String(val).trim().split(' ')[0]
  if (!t || t === '<<' || t.toLowerCase() === 'obd') return undefined

  const m1 = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m1) {
    let [, d, mo, y] = m1
    if (Number(y) < 100) y = '20' + y
    const dt = new Date(Number(y), Number(mo) - 1, Number(d))
    if (!isNaN(dt.getTime()) && dt.getFullYear() >= 1900 && dt.getFullYear() <= 2030) {
      return dt.toISOString().split('T')[0]
    }
  }
  
  const m2 = t.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/)
  if (m2) {
    const dt = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]))
    if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0]
  }
  
  return undefined
}

/**
 * Normaliza un RIT que puede venir "como sea" desde el Excel del usuario, y lo devuelve
 * en formato canónico: "LETRA-NUMERO-AÑO" (ej. "P-4596-2024") o, si no trae letra,
 * "NUMERO-AÑO" (ej. "4596-2024"). Devuelve undefined solo si NO se reconoce un
 * número + año válidos.
 *
 * FILOSOFÍA (importante): NUNCA inventa la letra. Si el Excel no trae letra, se conserva
 * SIN letra (el bot la confirma después contra el portal, que es la fuente de verdad).
 * Si trae letra, se respeta tal cual. Así no perdemos causas por formato y no falseamos datos.
 *
 * Formatos que ACEPTA (todos → canónico):
 *   P-4596-2024 | P 4596 2024 | P4596-2024 | p-4596-2024 | FA-123-2024 | RIT-1-2024
 *   4596-2024 | 4596/2024 | 4596.2024 | 4596 2024 | 4596-24 (año 2 dígitos → 2024)
 *   con espacios extra, guiones largos (–, —), separadores mezclados.
 */
function limpiarRIT(val: any): string | undefined {
  if (val === null || val === undefined) return undefined
  // 1) Normalizar: quitar espacios de borde, unificar guiones raros y separadores.
  let t = String(val).trim()
    .replace(/[–—]/g, '-')        // guiones largos → guion normal
    .replace(/\s+/g, ' ')          // colapsar espacios
    .toUpperCase()
    .trim()
  if (!t) return undefined

  // 2) Unificar separadores (/, ., espacios) a un guion. Deja letras y dígitos intactos.
  //    Ej: "4596/2024" → "4596-2024"; "P 4596 2024" → "P-4596-2024".
  t = t.replace(/[\s/.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

  // 3) Extraer componentes de forma tolerante:
  //    - letra opcional (0 a 3 letras): P, FA, RIT, o vacío
  //    - número (1+ dígitos, sin tope — alineado con parseRIT del bot que usa \d+)
  //    - año (2 o 4 dígitos)
  //    Aceptamos con o sin guion entre letra y número.
  const m = t.match(/^([A-Z]{0,3})-?(\d+)-(\d{2}|\d{4})$/)
  if (!m) return undefined

  const letra = m[1] || ''
  const numeroInt = parseInt(m[2], 10)
  if (!Number.isFinite(numeroInt) || numeroInt < 1) return undefined // no existe rol 0
  const numero = String(numeroInt) // sin ceros a la izquierda
  let año = m[3]
  // 4) Año de 2 dígitos → 4 dígitos. Heurística: 00–79 → 2000s, 80–99 → 1900s.
  //    (los RIT del PJUD son recientes; 24 → 2024, no 1924.)
  if (año.length === 2) {
    const n = parseInt(año, 10)
    año = (n <= 79 ? 2000 + n : 1900 + n).toString()
  }
  // Validación mínima de año razonable (1980–2099).
  const añoNum = parseInt(año, 10)
  if (añoNum < 1980 || añoNum > 2099) return undefined

  // 5) Formato canónico. Sin letra → "NUMERO-AÑO"; con letra → "LETRA-NUMERO-AÑO".
  return letra ? `${letra}-${numero}-${año}` : `${numero}-${año}`
}

function inferirPrograma(texto?: string): string | undefined {
  if (!texto) return undefined
  const u = texto.toUpperCase()
  const progs = ['PRM', 'PPF', 'FAE', 'PIE', 'PDE', 'PAS', 'MST', 'PEC', 'PDC', 'PEE', 'DAM', 'OPD', 'PIB']
  for (const p of progs) {
    if (u.includes(p)) return p
  }
  return undefined
}

/**
 * Letras de RIT VÁLIDAS para la columna causas.tipo. Se toman del catálogo central
 * de materias (src/lib/materiasFamilia.ts), que es la FUENTE ÚNICA DE VERDAD y debe
 * coincidir con el CHECK causas_tipo_check en la BD y con TIPOS_RIT_VALIDOS del bot.
 * Si un RIT trae un prefijo FUERA de esta lista, NO lo usamos como tipo (quedaría null)
 * para no violar el constraint y perder la causa en silencio.
 */
const TIPOS_TIPO_VALIDOS = LETRAS_VALIDAS

/**
 * Deriva el "tipo" (letra) de un RIT YA CANÓNICO (ver limpiarRIT).
 * - Si trae una letra VÁLIDA (P-4596-2024, FA-123-2024) → devuelve esa letra.
 * - Si NO trae letra (4596-2024) → devuelve undefined (NO se inventa; el bot la
 *   confirmará contra el portal).
 * - Si trae un prefijo NO reconocido (RUC-, ABC-, M-...) → devuelve undefined, NO lo
 *   fuerza como tipo. Escribir un tipo fuera del CHECK causas_tipo_check haría que la
 *   fila (y sus NNA/adultos) se descarten en silencio. Preferimos tipo=null (válido).
 */
function inferirTipo(rit: string): string | undefined {
  const m = (rit || '').toUpperCase().match(/^([A-Z]{1,3})-\d/)
  if (!m) return undefined
  return TIPOS_TIPO_VALIDOS.includes(m[1]) ? m[1] : undefined
}

// ============================================================
// DETECCIÓN DE COLUMNAS CONOCIDAS (para mapear a campos SQL)
// ============================================================

function isRitHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l === 'rit' || l === 'rol' || l === 'causa' || l.includes('n° causa') || l.includes('nro causa')
}

function isNombreHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l === 'nombre' || l === 'nombres' || l.includes('nombre nna') || l.includes('primer nombre')
}

function isApellidoHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l.includes('apellido')
}

function isAudienciaHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l.includes('audiencia') || l === 'fecha aud' || l.includes('fec aud') || l.includes('prox audiencia')
}

function isCaratuladoHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l.includes('caratulado') || l.includes('caratula') || l.includes('carátula')
}

function isEstadoHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l === 'estado' || l === 'etapa' || l.includes('situacion')
}

function isSintesisHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l.includes('sintesis') || l.includes('síntesis') || l.includes('resumen') || l.includes('observacion')
}

function isAdultoHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l.includes('adulto') || l.includes('responsable') || l.includes('cuidador') || l.includes('tutor')
}

function isTelefonoHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l.includes('telefono') || l.includes('teléfono') || l.includes('fono') || l.includes('celular')
}

function isRutHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l === 'rut' || l === 'run'
}

// ============================================================
// PARSER PRINCIPAL
// ============================================================

export function parseExcelBuffer(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  
  let bestResult: ParseResult | null = null
  
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
    
    const result = parseRows(rows, sheetName)
    if (result && result.causas.length > 0) {
      if (!bestResult || result.causas.length > bestResult.causas.length) {
        bestResult = result
      }
    }
  }
  
  if (bestResult) return bestResult
  
  return {
    causas: [],
    nna: [],
    adultos: [],
    audiencias: [],
    columnasDetectadas: [],
    hoja: wb.SheetNames[0] || 'N/A',
    totalFilas: 0,
  }
}

function parseRows(rows: any[][], sheetName: string): ParseResult | null {
  if (rows.length < 2) return null
  
  // Buscar fila de headers
  let headerRow = -1
  let headers: string[] = []
  let ritColIdx = -1
  
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i]
    if (!row) continue
    
    const cells = row.map((c: any) => String(c || '').trim())
    
    // Buscar columna RIT
    const ritIdx = cells.findIndex((c: string) => isRitHeader(c))
    if (ritIdx >= 0) {
      headerRow = i
      headers = cells
      ritColIdx = ritIdx
      break
    }
  }
  
  // Fallback: buscar por contenido
  if (headerRow === -1) {
    const found = findRITColumnByContent(rows)
    if (found) {
      headerRow = found.headerRow
      ritColIdx = found.col
      headers = rows[headerRow]?.map((c: any) => String(c || '').trim()) || []
    }
  }
  
  if (headerRow === -1 || ritColIdx === -1) return null
  
  // Identificar columnas conocidas
  const knownCols: Record<string, number> = { rit: ritColIdx }
  
  for (let i = 0; i < headers.length; i++) {
    if (i === ritColIdx) continue
    const h = headers[i]
    if (!h) continue
    
    if (isNombreHeader(h) && !knownCols.nombre) knownCols.nombre = i
    else if (isApellidoHeader(h) && !knownCols.apellido) knownCols.apellido = i
    else if (isAudienciaHeader(h) && !knownCols.audiencia) knownCols.audiencia = i
    else if (isCaratuladoHeader(h) && !knownCols.caratulado) knownCols.caratulado = i
    else if (isEstadoHeader(h) && !knownCols.estado) knownCols.estado = i
    else if (isSintesisHeader(h) && !knownCols.sintesis) knownCols.sintesis = i
    else if (isAdultoHeader(h) && !knownCols.adulto) knownCols.adulto = i
    else if (isTelefonoHeader(h) && !knownCols.telefono) knownCols.telefono = i
    else if (isRutHeader(h) && !knownCols.rut_nna) knownCols.rut_nna = i
  }
  
  // Parsear filas
  const causas: Map<string, CausaRaw> = new Map()
  const nnaList: NnaRaw[] = []
  const adultosList: AdultoRaw[] = []
  const audienciasList: AudienciaRaw[] = []
  let lastRit: string | undefined
  
  // Los headers limpios (sin vacíos)
  const cleanHeaders = headers.filter(h => h && h.trim())
  
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every((c: any) => !c)) continue
    
    // RIT
    let rit = limpiarRIT(row[ritColIdx])
    if (rit) {
      lastRit = rit
    } else {
      rit = lastRit
    }
    if (!rit) continue
    
    // ==========================================
    // GUARDAR TODAS LAS COLUMNAS en datos_extra
    // ==========================================
    const datosExtra: Record<string, any> = {}
    for (let col = 0; col < headers.length; col++) {
      if (col === ritColIdx) continue // RIT ya está en su campo propio
      const headerName = headers[col]
      if (!headerName) continue
      
      const value = row[col]
      if (value === null || value === undefined || String(value).trim() === '') continue
      
      // Guardar el valor limpio
      if (value instanceof Date) {
        if (!isNaN(value.getTime())) {
          datosExtra[headerName] = value.toISOString().split('T')[0]
        }
      } else if (typeof value === 'number') {
        if (!isNaN(value) && isFinite(value)) {
          datosExtra[headerName] = value
        }
      } else {
        const strVal = String(value).trim()
        if (strVal && strVal.toLowerCase() !== 'nan' && strVal.toLowerCase() !== 'none') {
          datosExtra[headerName] = strVal
        }
      }
    }
    
    // Causa (primera vez que aparece este RIT)
    if (!causas.has(rit)) {
      const estadoVal = knownCols.estado !== undefined ? limpiarTexto(row[knownCols.estado]) : undefined
      
      causas.set(rit, {
        rit,
        caratulado: knownCols.caratulado !== undefined ? limpiarTexto(row[knownCols.caratulado], 200) : undefined,
        tipo: inferirTipo(rit),
        fecha_apertura: undefined,
        sintesis: knownCols.sintesis !== undefined ? limpiarTexto(row[knownCols.sintesis]) : undefined,
        estado: estadoVal,
        programa_vigente: inferirPrograma(estadoVal || ''),
        notas: undefined,
        // TODAS las columnas extras
        datos_extra: datosExtra,
        columnas_origen: cleanHeaders,
      })
    } else {
      // Si la causa ya existe pero tiene más datos en esta fila, mergear datos_extra
      const existing = causas.get(rit)!
      if (existing.datos_extra) {
        for (const [key, val] of Object.entries(datosExtra)) {
          if (!existing.datos_extra[key]) {
            existing.datos_extra[key] = val
          }
        }
      }
    }
    
    // NNA
    const nombre = knownCols.nombre !== undefined ? limpiarTexto(row[knownCols.nombre], 100) : undefined
    const apellido = knownCols.apellido !== undefined ? limpiarTexto(row[knownCols.apellido], 100) : undefined
    
    if (nombre || apellido) {
      nnaList.push({
        _rit: rit,
        nombre,
        apellido,
        rut: knownCols.rut_nna !== undefined ? limpiarRut(row[knownCols.rut_nna]) : undefined,
      })
    }
    
    // Adulto
    const adultoNombre = knownCols.adulto !== undefined ? limpiarTexto(row[knownCols.adulto], 300) : undefined
    if (adultoNombre) {
      adultosList.push({
        _rit: rit,
        nombre: adultoNombre,
        telefono: knownCols.telefono !== undefined ? limpiarTexto(row[knownCols.telefono], 200) : undefined,
      })
    }
    
    // Audiencia
    const fechaAud = knownCols.audiencia !== undefined ? limpiarFecha(row[knownCols.audiencia]) : undefined
    if (fechaAud) {
      audienciasList.push({ _rit: rit, fecha: fechaAud })
    }
  }
  
  // Deduplicar adultos
  const adultosDedup: AdultoRaw[] = []
  const seenAdultos = new Set<string>()
  for (const a of adultosList) {
    const key = `${a._rit}|${a.nombre}`
    if (!seenAdultos.has(key)) {
      seenAdultos.add(key)
      adultosDedup.push(a)
    }
  }
  
  return {
    causas: Array.from(causas.values()),
    nna: nnaList,
    adultos: adultosDedup,
    audiencias: audienciasList,
    columnasDetectadas: cleanHeaders,
    hoja: sheetName,
    totalFilas: rows.length - headerRow - 1,
  }
}

function findRITColumnByContent(rows: any[][]): { col: number; headerRow: number } | null {
  for (let startRow = 0; startRow < Math.min(rows.length, 5); startRow++) {
    for (let col = 0; col < (rows[startRow]?.length || 0); col++) {
      let ritCount = 0
      for (let row = startRow + 1; row < Math.min(rows.length, startRow + 10); row++) {
        const val = rows[row]?.[col]
        if (val && limpiarRIT(val)) ritCount++
      }
      if (ritCount >= 3) return { col, headerRow: startRow }
    }
  }
  return null
}



/**
 * Versión que recibe rows ya parseados (desde el frontend)
 * El frontend usa XLSX.js para leer el archivo y envía los rows como JSON
 */
export function parseExcelRows(rows: any[][], sheetName: string): ParseResult {
  const result = parseRows(rows, sheetName)
  if (result) return result
  
  return {
    causas: [],
    nna: [],
    adultos: [],
    audiencias: [],
    columnasDetectadas: [],
    hoja: sheetName,
    totalFilas: 0,
  }
}
