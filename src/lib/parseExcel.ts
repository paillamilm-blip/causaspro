import * as XLSX from 'xlsx'

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

function limpiarRIT(val: any): string | undefined {
  if (!val) return undefined
  let t = String(val).trim()
    .replace(/\s+/g, '')
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .toUpperCase()
  
  const match = t.match(/^([A-Z])-(\d{1,6})-(\d{4})$/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  
  const match2 = t.match(/^([A-Z])(\d{1,6})-(\d{4})$/)
  if (match2) return `${match2[1]}-${match2[2]}-${match2[3]}`
  
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
  if (rit.startsWith('P')) return 'P'
  if (rit.startsWith('C')) return 'C'
  if (rit.startsWith('X')) return 'X'
  if (rit.startsWith('F')) return 'F'
  return undefined
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
