import * as XLSX from 'xlsx'

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
}

// ============================================================
// LIMPIEZA
// ============================================================

function limpiarTexto(val: any, max?: number): string | undefined {
  if (val === null || val === undefined) return undefined
  const t = String(val).trim()
  if (!t || t.toLowerCase() === 'nan' || t.toLowerCase() === 'none') return undefined
  return max ? t.slice(0, max) : t
}

function limpiarRut(val: any): string | undefined {
  if (!val) return undefined
  let t = String(val).trim()
  if (!t) return undefined
  // Quitar puntos
  t = t.replace(/\./g, '').replace(/\s/g, '')
  return t.slice(0, 30)
}

function limpiarFecha(val: any): string | undefined {
  if (!val) return undefined
  
  // Si Excel lo parseó como Date
  if (val instanceof Date) {
    return val.toISOString().split('T')[0]
  }
  
  // Si es número serial de Excel
  if (typeof val === 'number' && val > 10000) {
    const d = new Date((val - 25569) * 86400 * 1000)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }

  const t = String(val).trim().split(' ')[0]
  if (!t || t === '<<' || t.toLowerCase() === 'obd') return undefined

  // dd/mm/yyyy
  const m1 = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m1) {
    let [, d, mo, y] = m1
    if (Number(y) < 100) y = '20' + y
    const dt = new Date(Number(y), Number(mo) - 1, Number(d))
    if (!isNaN(dt.getTime()) && dt.getFullYear() >= 1900 && dt.getFullYear() <= 2030) {
      return dt.toISOString().split('T')[0]
    }
  }
  return undefined
}

function inferirPrograma(estado?: string): string | undefined {
  if (!estado) return undefined
  const u = estado.toUpperCase()
  const progs = ['PRM', 'PPF', 'FAE', 'PIE', 'PDE', 'PAS', 'MST', 'PEC', 'PDC', 'PEE']
  for (const p of progs) {
    if (u.includes(p)) return p
  }
  return undefined
}

// ============================================================
// PARSER PRINCIPAL
// ============================================================

export function parseExcelBuffer(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  
  // Usar primera hoja
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  // Detectar fila de headers buscando "rit"
  let headerRow = 0
  let colMap: Record<string, number> = {}

  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const row = rows[i]
    if (!row) continue
    const cells = row.map((c: any) => String(c || '').toLowerCase().trim())
    const ritIdx = cells.findIndex((c: string) => c === 'rit')
    if (ritIdx >= 0) {
      headerRow = i
      // Mapear columnas
      cells.forEach((c: string, idx: number) => {
        if (c === 'rit' && !colMap.rit) colMap.rit = idx
        else if (c.includes('caratulado')) colMap.caratulado = idx
        else if (c === 'nombre' || c.includes('nombre')) { if (!colMap.nombre) colMap.nombre = idx }
        else if (c.includes('apellido')) colMap.apellido = idx
        else if (c === 'rut' || c.includes('rut')) { if (!colMap.rut) colMap.rut = idx }
        else if (c.includes('nacimiento')) colMap.fecha_nacimiento = idx
        else if (c === 'edad') colMap.edad = idx
        else if (c.includes('nacionalidad')) colMap.nacionalidad = idx
        else if (c.includes('direccion') || c.includes('dirección')) colMap.direccion = idx
        else if (c.includes('adulto') || c.includes('responsable')) colMap.adulto = idx
        else if (c.includes('relacion') || c.includes('relación')) colMap.relacion = idx
        else if (c.includes('telefono') || c.includes('teléfono')) colMap.telefono = idx
        else if (c.includes('colegio')) colMap.colegio = idx
        else if (c === 'curso') colMap.curso = idx
        else if (c.includes('cesfam')) colMap.cesfam = idx
        else if (c.includes('sintesis') || c.includes('síntesis')) colMap.sintesis = idx
        else if (c === 'saj') colMap.saj = idx
        else if (c === 'audiencia') colMap.audiencia = idx
        else if (c.includes('apertura')) colMap.apertura = idx
        else if (c.includes('entrevista')) colMap.entrevista = idx
      })
      break
    }
  }

  // Fallback si no detectó headers
  if (!colMap.rit) {
    colMap = {
      rit: 4, caratulado: 5, saj: 6, entrevista: 7, sintesis: 8,
      nombre: 9, apellido: 10, rut: 11, fecha_nacimiento: 12, edad: 13,
      nacionalidad: 14, direccion: 16, adulto: 17, relacion: 18,
      telefono: 19, colegio: 20, curso: 21, cesfam: 22, audiencia: 1, apertura: 2,
    }
    headerRow = 2
  }

  // Parsear filas
  const causas: Map<string, CausaRaw> = new Map()
  const nnaList: NnaRaw[] = []
  const adultosList: AdultoRaw[] = []
  const audienciasList: AudienciaRaw[] = []
  let lastRit: string | undefined

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    const get = (key: string) => colMap[key] !== undefined ? row[colMap[key]] : undefined
    
    // RIT
    let rit = limpiarTexto(get('rit'))
    if (rit) {
      // Puede tener múltiples RIT separados por espacios
      rit = rit.split(/\s{2,}/)[0].trim()
      lastRit = rit
    } else {
      rit = lastRit
    }

    if (!rit) continue

    const nombre = limpiarTexto(get('nombre'), 100)
    const apellido = limpiarTexto(get('apellido'), 100)
    if (!nombre && !apellido) continue // Fila sin NNA, saltar

    // Estado desde columna A o B
    const estadoCol = limpiarTexto(row[1]) || limpiarTexto(row[0])

    // Causa (solo primera vez)
    if (!causas.has(rit)) {
      causas.set(rit, {
        rit,
        caratulado: limpiarTexto(get('caratulado'), 200),
        tipo: rit.toUpperCase().startsWith('P') ? 'P' : rit.toUpperCase().startsWith('X') ? 'X' : undefined,
        fecha_apertura: limpiarFecha(get('apertura')),
        sintesis: limpiarTexto(get('sintesis')),
        estado: limpiarTexto(estadoCol, 100),
        programa_vigente: inferirPrograma(estadoCol || ''),
        saj: limpiarTexto(get('saj'), 30),
        notas: limpiarTexto(get('entrevista')),
      })
    }

    // NNA
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
    const fechaAud = limpiarFecha(get('audiencia'))
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
  }
}
