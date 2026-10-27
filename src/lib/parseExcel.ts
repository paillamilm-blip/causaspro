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
  /** Identidad estable: número del RIT (ej. 4596), sin ceros a la izquierda. */
  rol?: number
  /** Identidad estable: año del RIT (ej. 2024). */
  anio?: number
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
  /**
   * La curadora pintó la fila de AZUL = causa cerrada/terminada. El color manda sobre el
   * texto de la columna de estado (hay filas azules que todavía dicen "PRM EN CURSO").
   * Solo es true si el RIT NO aparece también en una fila no azul: ante la duda queda
   * abierta, porque cerrar una causa viva hace que el bot deje de mirarla y se pierda
   * una audiencia.
   */
  cerrada_en_excel?: boolean
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
  /**
   * Filas que el parser NO pudo usar (no tienen RIT propio ni heredado de la fila
   * anterior). Se devuelven como aviso, no se descartan en silencio: en la migración
   * única del Excel, "el archivo tenía 400 filas y entraron 380" tiene que poder
   * explicarse sin tener que abrir el Excel otra vez. Va limitado a las primeras
   * muestras para no inflar la respuesta.
   */
  filasSinRit: string[]
  /**
   * RIT que aparece en una fila AZUL y también en una fila sin marcar. El color no alcanza
   * para decidir: se deja abierta y se informa, porque cerrar una causa viva es mucho más
   * caro que escanear una cerrada.
   */
  colorDudoso: string[]
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

/**
 * TODOS los RIT canónicos que hay dentro de UNA celda. La curadora anota en la misma
 * celda los expedientes vinculados de un NNA ("X-5305-2023    P-5935-2023",
 * "X-3615-2022//P-7664-2022", "X-4626-2023 P-15578-2022"): no es un RIT mal escrito,
 * son causas distintas y reales. En su Excel son más las celdas con varios RIT (876)
 * que las de uno solo (826), así que esto no es un caso borde: es la forma habitual.
 *
 * Devuelve [] si no reconoce NINGUNO (ej. "X-241-20226", año de 5 dígitos). En ese caso
 * el llamador debe INFORMAR la fila, nunca heredar el RIT del renglón anterior.
 */
export function extraerRITs(val: any): string[] {
  if (val === null || val === undefined) return []
  const unico = limpiarRIT(val)
  if (unico) return [unico]

  const t = String(val).toUpperCase().replace(/[–—]/g, '-')
  const out: string[] = []
  // \d{2,4} y NO (\d{2}|\d{4}): la alternancia probaba \d{2} primero y cortaba "2023" en
  // "20". Y (?!\d) para no "corregir" un año mal tipeado recortándole dígitos: si la
  // celda dice 20226, no se adivina, se reporta.
  const re = /[A-Z]{0,3}\s*[-/.]?\s*\d{1,6}\s*[-/.]\s*\d{2,4}(?!\d)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    const can = limpiarRIT(m[0])
    if (can && !out.includes(can)) out.push(can)
  }
  return out
}

// ============================================================
// COLOR DE LA FILA = estado de la causa
// ------------------------------------------------------------
// En el Excel de la curadora la vida o muerte de una causa NO está en una columna: está
// en el RELLENO de la fila. Ella lo confirmó sin ambigüedad: "diga lo que diga, si están
// en azul están cerradas". Como el color no es un dato que el parser pueda adivinar, se
// lee acá (SheetJS con cellStyles) y se le pasa al parser como una marca por fila.
//
// Se clasifica por TONO (HSL) y no comparando hexadecimales a ojo: en su archivo hay
// nueve azules distintos (0B5394, 1C4587, 073763, CFE2F3, D9E1F2, 9FC5E8, C9DAF8,
// 6FA8DC, 4A86E8) y además cian puro (00FFFF) y violetas (8E7CC3, D9D2E9) que NO son
// azul. El cian se deja FUERA a propósito: cerrar de más una causa viva cuesta una
// audiencia perdida; escanear una cerrada cuesta minutos de bot.
// ============================================================

function hslDeHex(hex: string): { h: number; s: number } {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  if (d === 0) return { h: 0, s: 0 }
  const s = d / (1 - Math.abs(2 * l - 1))
  let hh = 0
  if (max === r) hh = 60 * (((g - b) / d) % 6)
  else if (max === g) hh = 60 * ((b - r) / d + 2)
  else hh = 60 * ((r - g) / d + 4)
  if (hh < 0) hh += 360
  return { h: hh, s: s * 100 }
}

/** AZUL de verdad: tono 190–240 con algo de saturación. Excluye cian (180), violeta (255+) y grises. */
export function esAzulCerrada(hex: string): boolean {
  // SheetJS suele dar el color como ARGB de 8 dígitos ("FF0B5394"); se toma el RGB final.
  const limpio = String(hex || '').replace('#', '').trim()
  if (!/^([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(limpio)) return false
  const { h, s } = hslDeHex(limpio.slice(-6).toUpperCase())
  return h >= 190 && h <= 240 && s >= 12
}

/**
 * Color dominante de una fila: el relleno que más celdas ocupa, ignorando blanco y sin
 * relleno. Se mira TODA la fila y no solo la celda del RIT porque en este Excel la celda
 * del RIT suele estar sin pintar (1086 de 2467) mientras el resto de la fila sí lo está.
 */
export function colorDominanteFila(celdas: any[]): string | null {
  const conta = new Map<string, number>()
  for (const c of celdas || []) {
    const rgb = c?.s?.fgColor?.rgb
    if (!rgb) continue
    const hex = String(rgb).toUpperCase().slice(-6)
    if (hex === 'FFFFFF' || hex === '000000') continue
    conta.set(hex, (conta.get(hex) || 0) + 1)
  }
  if (conta.size === 0) return null
  return [...conta.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/**
 * Marca, por índice de fila, cuáles están CERRADAS en el Excel: fila pintada de AZUL o
 * fila OCULTA. La curadora saca de su vista diaria las causas que ya no gestiona
 * ocultando la fila (1089 ocultas en el Excel de oct-2026), así que la fila oculta es
 * tan cierre como el azul. El índice coincide con el de
 * `XLSX.utils.sheet_to_json(ws, { header: 1 })`, así que el parser puede cruzarlo
 * directo con `rows[i]`. Hay que leer el archivo con `cellStyles: true` o el color
 * devuelve todo false en silencio.
 */
export function filasCerradasEnExcel(ws: XLSX.WorkSheet): boolean[] {
  const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  const filas: any[] = (ws as any)['!rows'] || []
  const out: boolean[] = []
  for (let r = 0; r <= ref.e.r; r++) {
    if (filas[r] && filas[r].hidden) { out.push(true); continue }
    const celdas: any[] = []
    for (let c = 0; c <= ref.e.c; c++) celdas.push(ws[XLSX.utils.encode_cell({ r, c })])
    const color = colorDominanteFila(celdas)
    out.push(color ? esAzulCerrada(color) : false)
  }
  return out
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

/**
 * Extrae el ROL (número) y el AÑO de un RIT YA CANÓNICO (ver limpiarRIT), que puede
 * venir con letra ("P-4596-2024") o sin letra ("4596-2024"). Devuelve el número SIN
 * ceros a la izquierda (parseInt) y el año como entero. Es la identidad ESTABLE de la
 * causa (no depende de la letra). Retorna {} si el rit no calza el patrón número-año.
 */
function parseRolAnio(rit: string): { rol?: number; anio?: number } {
  const m = (rit || '').match(/(\d+)-(\d{4})$/)
  if (!m) return {}
  const rol = parseInt(m[1], 10)
  const anio = parseInt(m[2], 10)
  return {
    rol: Number.isFinite(rol) ? rol : undefined,
    anio: Number.isFinite(anio) ? anio : undefined,
  }
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

// ---- Campos del NNA que la interfaz NnaRaw ya declaraba pero nadie llenaba ----
// El Excel de la curadora los trae ("fecha nacimiento", "edad", "Nacionalidad",
// "Direccion", "Colegio", "Curso", "Cesfam"). Iban a parar a datos_extra de la CAUSA,
// así que la ficha del NNA y el reporte salían sin ellos.
function isFechaNacimientoHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l.includes('nacimiento') || l.includes('fec nac') || l.includes('fecha nac')
}

function isEdadHeader(h: string): boolean {
  return h.toLowerCase().trim() === 'edad'
}

function isNacionalidadHeader(h: string): boolean {
  return h.toLowerCase().includes('nacionalidad')
}

function isDireccionHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l.includes('direccion') || l.includes('dirección') || l.includes('domicilio')
}

function isColegioHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l.includes('colegio') || l.includes('escuela') || l.includes('liceo')
}

function isCursoHeader(h: string): boolean {
  return h.toLowerCase().trim() === 'curso'
}

function isCesfamHeader(h: string): boolean {
  return h.toLowerCase().includes('cesfam')
}

function isRelacionHeader(h: string): boolean {
  const l = h.toLowerCase()
  return l.includes('relacion') || l.includes('relación') || l.includes('parentesco')
}

// ============================================================
// PARSER PRINCIPAL
// ============================================================

export function parseExcelBuffer(buffer: ArrayBuffer): ParseResult {
  // cellStyles: sin esto SheetJS no expone el relleno de la celda y el "azul = cerrada"
  // de la curadora se pierde en silencio.
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, cellStyles: true })
  
  let bestResult: ParseResult | null = null
  
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
    
    const result = parseRows(rows, sheetName, filasCerradasEnExcel(ws))
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
    filasSinRit: [],
    colorDudoso: [],
  }
}

function parseRows(rows: any[][], sheetName: string, filasCerradas?: boolean[]): ParseResult | null {
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
    
    if (isNombreHeader(h) && knownCols.nombre === undefined) knownCols.nombre = i
    else if (isApellidoHeader(h) && knownCols.apellido === undefined) knownCols.apellido = i
    else if (isAudienciaHeader(h) && knownCols.audiencia === undefined) knownCols.audiencia = i
    else if (isCaratuladoHeader(h) && knownCols.caratulado === undefined) knownCols.caratulado = i
    else if (isEstadoHeader(h) && knownCols.estado === undefined) knownCols.estado = i
    else if (isSintesisHeader(h) && knownCols.sintesis === undefined) knownCols.sintesis = i
    else if (isAdultoHeader(h) && knownCols.adulto === undefined) knownCols.adulto = i
    else if (isRelacionHeader(h) && knownCols.relacion === undefined) knownCols.relacion = i
    else if (isTelefonoHeader(h) && knownCols.telefono === undefined) knownCols.telefono = i
    else if (isRutHeader(h) && knownCols.rut_nna === undefined) knownCols.rut_nna = i
    else if (isFechaNacimientoHeader(h) && knownCols.fecha_nacimiento === undefined) knownCols.fecha_nacimiento = i
    else if (isEdadHeader(h) && knownCols.edad === undefined) knownCols.edad = i
    else if (isNacionalidadHeader(h) && knownCols.nacionalidad === undefined) knownCols.nacionalidad = i
    else if (isDireccionHeader(h) && knownCols.direccion === undefined) knownCols.direccion = i
    else if (isColegioHeader(h) && knownCols.colegio === undefined) knownCols.colegio = i
    else if (isCursoHeader(h) && knownCols.curso === undefined) knownCols.curso = i
    else if (isCesfamHeader(h) && knownCols.cesfam === undefined) knownCols.cesfam = i
  }

  // La columna de estado de la curadora NO tiene encabezado: en su Excel la columna A
  // arranca vacía en la fila de títulos y abajo dice "PRM EN CURSO", "RELEVO",
  // "ARCHIVADA", "FUERA DEL PAIS"… Sin este respaldo esa columna se perdía entera (y con
  // ella el programa vigente, que se deduce del estado). Solo se usa cuando el parser no
  // encontró ninguna columna de estado y la primera no tiene título.
  if (knownCols.estado === undefined && ritColIdx !== 0 && !String(headers[0] || '').trim()) {
    knownCols.estado = 0
  }
  
  // Parsear filas
  const causas: Map<string, CausaRaw> = new Map()
  const nnaList: NnaRaw[] = []
  const adultosList: AdultoRaw[] = []
  const audienciasList: AudienciaRaw[] = []
  let lastRit: string | undefined
  /** Muestras de filas descartadas por no tener RIT (ver ParseResult.filasSinRit). */
  const filasSinRit: string[] = []
  /**
   * RIT según el color de su fila. Se anotan SOLO los RIT que la propia celda trae (no los
   * heredados de la fila anterior): un renglón de continuación sin pintar no puede reabrir
   * una causa cuyo bloque está azul. Un RIT que cae en las dos listas queda abierto.
   */
  const ritsAzul = new Set<string>()
  const ritsNoAzul = new Set<string>()
  
  // Los headers limpios (sin vacíos)
  const cleanHeaders = headers.filter(h => h && h.trim())
  
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every((c: any) => !c)) continue
    
    // RIT. La celda puede traer VARIOS expedientes del mismo NNA: se cargan todos y la
    // fila queda colgada del primero (el que la curadora anotó primero).
    const celdaRit = row[ritColIdx]
    const ritsFila = extraerRITs(celdaRit)
    const celdaRitVacia = celdaRit === null || celdaRit === undefined || String(celdaRit).trim() === ''
    let rit: string | undefined
    let vinculados: string[] = []
    if (ritsFila.length > 0) {
      rit = ritsFila[0]
      vinculados = ritsFila.slice(1)
      lastRit = rit
      const destino = filasCerradas?.[i] ? ritsAzul : ritsNoAzul
      for (const r of ritsFila) destino.add(r)
    } else if (celdaRitVacia) {
      // Celda VACÍA = renglón de continuación (varios NNA bajo la misma causa). Heredar
      // el RIT anterior es correcto y es el motivo por el que el Excel tiene filas sin RIT.
      rit = lastRit
    }
    // Celda CON contenido pero sin ningún RIT reconocible: NO se hereda el anterior.
    // Antes sí se heredaba, y eso le pegaba los NNA/adultos/audiencias de esta fila a
    // OTRA causa — corrupción silenciosa que el diff no mostraba (salía "1 fila sin RIT"
    // cuando eran 876 filas mal atribuidas). Ahora se informa.
    if (!rit) {
      // Fila útil pero sin RIT propio ni heredado: se informa (hasta 20 muestras) en vez
      // de desaparecer. Es la diferencia entre "entraron 380 de 400" y poder decir CUÁLES.
      if (filasSinRit.length < 20) {
        const muestra = row
          .filter((c: any) => c !== null && c !== undefined && String(c).trim() !== '')
          .slice(0, 3)
          .map((c: any) => String(c).trim().slice(0, 30))
          .join(' / ')
        filasSinRit.push(`fila ${i + 1}${muestra ? `: ${muestra}` : ''}`)
      }
      continue
    }
    
    // ==========================================
    // GUARDAR TODAS LAS COLUMNAS en datos_extra
    // ==========================================
    const datosExtra: Record<string, any> = {}
    for (let col = 0; col < headers.length; col++) {
      if (col === ritColIdx) continue // RIT ya está en su campo propio
      // Las columnas SIN título igual se guardan, con nombre sintético: descartarlas era
      // perder la columna A del Excel de la curadora (su estado operativo).
      const headerName = headers[col] || `columna_${col + 1}`
      
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
    
    // Los otros expedientes de la misma celda quedan anotados en la causa principal.
    if (vinculados.length > 0) datosExtra.rits_vinculados = vinculados.join(', ')

    // Causa (primera vez que aparece este RIT)
    if (!causas.has(rit)) {
      const estadoVal = knownCols.estado !== undefined ? limpiarTexto(row[knownCols.estado], 200) : undefined

      causas.set(rit, {
        rit,
        ...parseRolAnio(rit), // rol + anio (identidad estable, derivados del rit canónico)
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

    // Los expedientes vinculados de la misma celda TAMBIÉN se cargan: son causas reales
    // que el bot tiene que mirar. Pero SIN duplicar los NNA/adultos/audiencias de la fila
    // (esos quedan en la principal): un niño anotado una vez, dos expedientes que lo
    // referencian. El vínculo queda en datos_extra de los dos lados.
    const caratuladoFila = knownCols.caratulado !== undefined ? limpiarTexto(row[knownCols.caratulado], 200) : undefined
    for (const v of vinculados) {
      if (causas.has(v)) continue
      causas.set(v, {
        rit: v,
        ...parseRolAnio(v),
        // El caratulado es el de la familia: en un par P↔X es el mismo. La síntesis NO se
        // copia, describe los hechos de la causa principal y no se puede afirmar que sean
        // los de la hermana.
        caratulado: caratuladoFila,
        tipo: inferirTipo(v),
        fecha_apertura: undefined,
        sintesis: undefined,
        estado: undefined,
        programa_vigente: undefined,
        notas: undefined,
        datos_extra: { rits_vinculados: ritsFila.filter(x => x !== v).join(', ') },
        columnas_origen: cleanHeaders,
      })
    }

    // NNA
    const nombre = knownCols.nombre !== undefined ? limpiarTexto(row[knownCols.nombre], 100) : undefined
    const apellido = knownCols.apellido !== undefined ? limpiarTexto(row[knownCols.apellido], 100) : undefined
    
    if (nombre || apellido) {
      const del = (k: string, max?: number) =>
        knownCols[k] !== undefined ? limpiarTexto(row[knownCols[k]], max) : undefined
      const edadCruda = knownCols.edad !== undefined ? Number(row[knownCols.edad]) : NaN
      nnaList.push({
        _rit: rit,
        nombre,
        apellido,
        rut: knownCols.rut_nna !== undefined ? limpiarRut(row[knownCols.rut_nna]) : undefined,
        fecha_nacimiento: knownCols.fecha_nacimiento !== undefined
          ? limpiarFecha(row[knownCols.fecha_nacimiento])
          : undefined,
        // La edad del Excel viene con decimales y ya está vencida; la columna es
        // NUMERIC(5,1), así que se redondea a un decimal. Con fecha_nacimiento al lado,
        // la edad exacta se puede recalcular cuando haga falta.
        edad: Number.isFinite(edadCruda) && edadCruda > 0 && edadCruda < 130
          ? Math.round(edadCruda * 10) / 10
          : undefined,
        nacionalidad: del('nacionalidad', 60),
        direccion: del('direccion', 300),
        colegio: del('colegio', 200),
        curso: del('curso', 60),
        cesfam: del('cesfam', 200),
      })
    }
    
    // Adulto
    const adultoNombre = knownCols.adulto !== undefined ? limpiarTexto(row[knownCols.adulto], 300) : undefined
    if (adultoNombre) {
      adultosList.push({
        _rit: rit,
        nombre: adultoNombre,
        // "Relacion" (madre, abuela, tío…) ya estaba declarado en AdultoRaw y no se llenaba.
        // La dirección NO se copia: la del Excel es la del NNA y afirmar que es la del
        // adulto sería inventar.
        relacion: knownCols.relacion !== undefined ? limpiarTexto(row[knownCols.relacion], 100) : undefined,
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
    // Mismo criterio que db/migraciones/schema-dedup-hijos.sql: causa + nombre + relación + teléfono.
    const key = `${a._rit}|${a.nombre}|${a.relacion || ''}|${a.telefono || ''}`
    if (!seenAdultos.has(key)) {
      seenAdultos.add(key)
      adultosDedup.push(a)
    }
  }
  
  const causasParseadas = Array.from(causas.values())
  // Solo se marca si el archivo venía con colores leídos: si el frontend no mandó las
  // marcas, `cerrada_en_excel` queda undefined (no false) para que nadie crea que el
  // archivo decía que todas estaban abiertas.
  if (filasCerradas?.some(Boolean)) {
    for (const c of causasParseadas) {
      if (ritsAzul.has(c.rit) && !ritsNoAzul.has(c.rit)) c.cerrada_en_excel = true
    }
  }

  return {
    causas: causasParseadas,
    nna: nnaList,
    adultos: adultosDedup,
    audiencias: audienciasList,
    columnasDetectadas: cleanHeaders,
    hoja: sheetName,
    totalFilas: rows.length - headerRow - 1,
    filasSinRit,
    colorDudoso: [...ritsAzul].filter(r => ritsNoAzul.has(r)),
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
 * Versión que recibe rows ya parseados (desde el navegador).
 * El frontend usa XLSX.js para leer el archivo y envía los rows como JSON.
 * `filasCerradas` es opcional: un booleano por fila (mismo índice que `rows`) con las que
 * están cerradas según el Excel (fila oculta O pintada de azul). Se calcula con
 * filasCerradasEnExcel() en el navegador, porque ni el color ni el estado oculto
 * sobreviven al viaje como JSON.
 */
export function parseExcelRows(
  rows: any[][],
  sheetName: string,
  filasCerradas?: boolean[],
): ParseResult {
  const result = parseRows(rows, sheetName, filasCerradas)
  if (result) return result
  
  return {
    causas: [],
    nna: [],
    adultos: [],
    audiencias: [],
    columnasDetectadas: [],
    hoja: sheetName,
    totalFilas: rows.length,
    // Si el parser no encontró la columna RIT, TODAS las filas son irreconocibles:
    // se avisa con las primeras muestras para que la usuaria vea qué leyó mal el archivo.
    filasSinRit: rows
      .slice(0, 20)
      .map((r, idx) => {
        const muestra = (r || [])
          .filter((c: any) => c !== null && c !== undefined && String(c).trim() !== '')
          .slice(0, 3)
          .map((c: any) => String(c).trim().slice(0, 30))
          .join(' / ')
        return muestra ? `fila ${idx + 1}: ${muestra}` : null
      })
      .filter((l): l is string => l !== null),
    colorDudoso: [],
  }
}
