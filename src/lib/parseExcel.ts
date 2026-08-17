import * as XLSX from 'xlsx'

// ============================================================
// CAUSASPRO - Parser Universal de Documentos
// Acepta cualquier Excel/CSV que tenga una columna con RIT
// Detecta automáticamente las columnas disponibles
// ============================================================

// Tipos
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
  /** Columnas detectadas automáticamente */
  columnasDetectadas: string[]
  /** Hoja utilizada */
  hoja: string
  /** Total filas procesadas */
  totalFilas: number
}

// ============================================================
// DETECCIÓN INTELIGENTE DE COLUMNAS
// ============================================================

interface ColumnMapping {
  rit: number
  caratulado?: number
  nombre?: number
  apellido?: number
  rut?: number
  fecha_nacimiento?: number
  edad?: number
  nacionalidad?: number
  direccion?: number
  adulto?: number
  relacion?: number
  telefono?: number
  colegio?: number
  curso?: number
  cesfam?: number
  sintesis?: number
  saj?: number
  audiencia?: number
  fecha_audiencia?: number
  apertura?: number
  fecha_ingreso?: number
  entrevista?: number
  estado?: number
  programa?: number
  curador?: number
  tribunal?: number
  juez?: number
  materia?: number
}

/** Patrones para detectar columnas (case insensitive) */
const COLUMN_PATTERNS: Record<keyof ColumnMapping, string[]> = {
  rit: ['rit', 'rol', 'causa', 'nro causa', 'n° causa', 'numero causa'],
  caratulado: ['caratulado', 'caratula', 'carátula', 'partes'],
  nombre: ['nombre', 'nombres', 'nombre nna', 'nombre niño', 'primer nombre'],
  apellido: ['apellido', 'apellidos', 'apellido paterno', 'ape paterno'],
  rut: ['rut', 'run', 'rut nna', 'cedula'],
  fecha_nacimiento: ['nacimiento', 'fec nac', 'fecha nac', 'f. nacimiento'],
  edad: ['edad', 'años'],
  nacionalidad: ['nacionalidad', 'pais', 'país'],
  direccion: ['direccion', 'dirección', 'domicilio', 'dir'],
  adulto: ['adulto', 'responsable', 'padre', 'madre', 'tutor', 'cuidador', 'adulto responsable'],
  relacion: ['relacion', 'relación', 'parentesco', 'vinculo', 'vínculo'],
  telefono: ['telefono', 'teléfono', 'fono', 'celular', 'tel', 'contacto'],
  colegio: ['colegio', 'escuela', 'establecimiento', 'institucion educativa'],
  curso: ['curso', 'nivel', 'grado'],
  cesfam: ['cesfam', 'consultorio', 'centro salud', 'salud'],
  sintesis: ['sintesis', 'síntesis', 'resumen', 'descripcion', 'descripción', 'detalle', 'observacion'],
  saj: ['saj', 'sistema', 'codigo', 'código'],
  audiencia: ['audiencia', 'fecha aud', 'fec aud', 'fecha audiencia', 'prox audiencia'],
  fecha_audiencia: ['fecha aud', 'fec aud', 'audiencia', 'prox audiencia', 'proxima audiencia'],
  apertura: ['apertura', 'fecha apertura', 'inicio', 'fecha inicio'],
  fecha_ingreso: ['ingreso', 'fecha ing', 'fec ing', 'fecha ingreso', 'fecha asignacion'],
  entrevista: ['entrevista', 'fecha entrevista', 'primera entrevista'],
  estado: ['estado', 'etapa', 'situacion', 'situación', 'status'],
  programa: ['programa', 'prog', 'programa vigente', 'tipo programa'],
  curador: ['curador', 'abogado', 'profesional', 'asignado', 'curador ad litem'],
  tribunal: ['tribunal', 'juzgado', 'corte'],
  juez: ['juez', 'magistrado'],
  materia: ['materia', 'tipo causa', 'tipo'],
}

/**
 * Detecta automáticamente las columnas de un header row
 */
function detectColumns(headerCells: string[]): { mapping: ColumnMapping; detected: string[] } {
  const mapping: Partial<ColumnMapping> = {}
  const detected: string[] = []
  
  for (let i = 0; i < headerCells.length; i++) {
    const cell = headerCells[i].toLowerCase().trim()
    if (!cell) continue
    
    for (const [key, patterns] of Object.entries(COLUMN_PATTERNS)) {
      if (mapping[key as keyof ColumnMapping] !== undefined) continue // Ya detectada
      
      for (const pattern of patterns) {
        if (cell === pattern || cell.includes(pattern)) {
          mapping[key as keyof ColumnMapping] = i
          detected.push(`${key}→col${i}(${headerCells[i]})`)
          break
        }
      }
    }
  }
  
  // Si no se detectó RIT, buscar celdas que parezcan RIT por contenido
  if (mapping.rit === undefined) {
    // Fallback: buscar columna que contenga algo tipo "P-123-2024"
    return { mapping: mapping as ColumnMapping, detected }
  }
  
  return { mapping: mapping as ColumnMapping, detected }
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
  
  // Si Excel lo parseó como Date
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return undefined
    return val.toISOString().split('T')[0]
  }
  
  // Si es número serial de Excel
  if (typeof val === 'number' && val > 10000) {
    const d = new Date((val - 25569) * 86400 * 1000)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }

  const t = String(val).trim().split(' ')[0]
  if (!t || t === '<<' || t.toLowerCase() === 'obd') return undefined

  // dd/mm/yyyy o dd-mm-yyyy
  const m1 = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m1) {
    let [, d, mo, y] = m1
    if (Number(y) < 100) y = '20' + y
    const dt = new Date(Number(y), Number(mo) - 1, Number(d))
    if (!isNaN(dt.getTime()) && dt.getFullYear() >= 1900 && dt.getFullYear() <= 2030) {
      return dt.toISOString().split('T')[0]
    }
  }
  
  // yyyy-mm-dd (ISO)
  const m2 = t.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/)
  if (m2) {
    const dt = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]))
    if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0]
  }
  
  return undefined
}

function limpiarRIT(val: any): string | undefined {
  if (!val) return undefined
  let t = String(val).trim()
    .replace(/\s+/g, '')
    .replace(/–/g, '-')  // Dash largo
    .replace(/—/g, '-')  // Em dash
    .toUpperCase()
  
  // Validar formato: LETRA-NUMERO-AÑO
  const match = t.match(/^([A-Z])-(\d{1,6})-(\d{4})$/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  
  // Formato sin el primer guión: P1234-2024
  const match2 = t.match(/^([A-Z])(\d{1,6})-(\d{4})$/)
  if (match2) return `${match2[1]}-${match2[2]}-${match2[3]}`
  
  // Formato completo con espacios: P - 1234 - 2024
  const match3 = t.replace(/\s/g, '').match(/^([A-Z])-?(\d{1,6})-?(\d{4})$/)
  if (match3) return `${match3[1]}-${match3[2]}-${match3[3]}`
  
  return undefined
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

function inferirTipo(rit: string): string | undefined {
  if (rit.startsWith('P')) return 'P'  // Protección
  if (rit.startsWith('C')) return 'C'  // Civil
  if (rit.startsWith('X')) return 'X'  // Otros
  if (rit.startsWith('F')) return 'F'  // Familia
  return undefined
}

// ============================================================
// PARSER PRINCIPAL - UNIVERSAL
// ============================================================

export function parseExcelBuffer(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  
  // Intentar con cada hoja hasta encontrar una con RIT
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
  
  // Fallback: retornar vacío
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
  
  // Buscar fila de headers (buscar "RIT" en las primeras 10 filas)
  let headerRow = -1
  let colMap: ColumnMapping | null = null
  let detected: string[] = []
  
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i]
    if (!row) continue
    
    const cells = row.map((c: any) => String(c || '').trim())
    
    // ¿Alguna celda contiene "RIT" o similar?
    const hasRIT = cells.some((c: string) => {
      const lower = c.toLowerCase()
      return lower === 'rit' || lower === 'rol' || lower === 'causa' || lower.includes('n° causa') || lower.includes('nro causa')
    })
    
    if (hasRIT) {
      const result = detectColumns(cells)
      if (result.mapping.rit !== undefined) {
        headerRow = i
        colMap = result.mapping
        detected = result.detected
        break
      }
    }
  }
  
  // Si no encontramos header, buscar RIT por contenido (primera columna con formato P-XXX-YYYY)
  if (headerRow === -1) {
    const ritCol = findRITColumnByContent(rows)
    if (ritCol !== null) {
      headerRow = ritCol.headerRow
      colMap = { rit: ritCol.col } as ColumnMapping
      detected = [`rit→col${ritCol.col}(auto-detectado por contenido)`]
    }
  }
  
  if (headerRow === -1 || !colMap || colMap.rit === undefined) return null
  
  // Parsear filas de datos
  const causas: Map<string, CausaRaw> = new Map()
  const nnaList: NnaRaw[] = []
  const adultosList: AdultoRaw[] = []
  const audienciasList: AudienciaRaw[] = []
  let lastRit: string | undefined
  
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every((c: any) => !c)) continue  // Fila vacía
    
    const get = (key: keyof ColumnMapping) => {
      const idx = colMap![key]
      return idx !== undefined ? row[idx] : undefined
    }
    
    // RIT
    let rit = limpiarRIT(get('rit'))
    if (rit) {
      lastRit = rit
    } else {
      rit = lastRit
    }
    
    if (!rit) continue
    
    // Causa (solo primera vez que aparece este RIT)
    if (!causas.has(rit)) {
      const estadoText = limpiarTexto(get('estado'))
      const programaText = limpiarTexto(get('programa'))
      
      causas.set(rit, {
        rit,
        caratulado: limpiarTexto(get('caratulado'), 200),
        tipo: inferirTipo(rit),
        fecha_apertura: limpiarFecha(get('apertura')) || limpiarFecha(get('fecha_ingreso')),
        sintesis: limpiarTexto(get('sintesis')),
        estado: estadoText,
        programa_vigente: programaText || inferirPrograma(estadoText || ''),
        saj: limpiarTexto(get('saj'), 30),
        notas: limpiarTexto(get('entrevista')),
      })
    }
    
    // NNA (si hay columna de nombre)
    const nombre = limpiarTexto(get('nombre'), 100)
    const apellido = limpiarTexto(get('apellido'), 100)
    
    if (nombre || apellido) {
      nnaList.push({
        _rit: rit,
        nombre,
        apellido,
        rut: limpiarRut(get('rut')),
        fecha_nacimiento: limpiarFecha(get('fecha_nacimiento')),
        edad: get('edad') && !isNaN(Number(get('edad'))) ? Number(Number(get('edad')).toFixed(1)) : undefined,
        nacionalidad: limpiarTexto(get('nacionalidad'), 50),
        direccion: limpiarTexto(get('direccion')),
        colegio: limpiarTexto(get('colegio'), 200),
        curso: limpiarTexto(get('curso'), 50),
        cesfam: limpiarTexto(get('cesfam'), 200),
      })
    }
    
    // Adulto
    const adultoNombre = limpiarTexto(get('adulto'), 300)
    if (adultoNombre) {
      adultosList.push({
        _rit: rit,
        nombre: adultoNombre,
        relacion: limpiarTexto(get('relacion'), 80),
        telefono: limpiarTexto(get('telefono'), 200),
        direccion: limpiarTexto(get('direccion')),
      })
    }
    
    // Audiencia
    const fechaAud = limpiarFecha(get('audiencia')) || limpiarFecha(get('fecha_audiencia'))
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
    columnasDetectadas: detected,
    hoja: sheetName,
    totalFilas: rows.length - headerRow - 1,
  }
}

/**
 * Busca la columna que contiene RITs por su contenido (formato P-XXX-YYYY)
 * Útil cuando no hay headers claros
 */
function findRITColumnByContent(rows: any[][]): { col: number; headerRow: number } | null {
  // Revisar las primeras filas para encontrar una columna con formato RIT
  for (let startRow = 0; startRow < Math.min(rows.length, 5); startRow++) {
    for (let col = 0; col < (rows[startRow]?.length || 0); col++) {
      let ritCount = 0
      
      // Contar cuántas filas tienen formato RIT en esta columna
      for (let row = startRow + 1; row < Math.min(rows.length, startRow + 10); row++) {
        const val = rows[row]?.[col]
        if (val && limpiarRIT(val)) {
          ritCount++
        }
      }
      
      // Si >50% de las filas tienen RIT, esta es la columna
      if (ritCount >= 3) {
        return { col, headerRow: startRow }
      }
    }
  }
  
  return null
}
