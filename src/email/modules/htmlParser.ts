// ============================================================
// CAUSASPRO EMAIL - HTML Table Parser
// Parsea la tabla de ASIGNACIONES del correo
// Formato: RIT | FECHA AUD | FECHA ING | CURADOR
// ============================================================

import type { AsignacionEmail } from '../types'

/**
 * Parsea el HTML del email y extrae las asignaciones de la tabla
 * 
 * Formato esperado:
 * | RIT          | FECHA AUD   | FECHA ING   | CURADOR      |
 * | P-8141-2026  | 20/08/2026  | 10/08/2026  | PAULA VARGAS |
 */
export function parseAsignacionesFromHtml(html: string): AsignacionEmail[] {
  const asignaciones: AsignacionEmail[] = []
  
  if (!html) return asignaciones
  
  // Extraer todas las tablas del HTML
  const tables = extractTables(html)
  
  for (const table of tables) {
    const rows = extractRows(table)
    
    if (rows.length < 2) continue // Necesita al menos header + 1 fila
    
    // Detectar si es la tabla de asignaciones (buscar header con RIT)
    const headerRow = rows[0]
    const headers = extractCells(headerRow).map(h => h.toUpperCase().trim())
    
    const ritCol = findColumnIndex(headers, ['RIT', 'ROL', 'CAUSA'])
    const fechaAudCol = findColumnIndex(headers, ['FECHA AUD', 'AUDIENCIA', 'FEC. AUD', 'FECHA_AUD'])
    const fechaIngCol = findColumnIndex(headers, ['FECHA ING', 'INGRESO', 'FEC. ING', 'FECHA_ING', 'FECHA INGRESO'])
    const curadorCol = findColumnIndex(headers, ['CURADOR', 'ABOGADO', 'ASIGNADO'])
    
    // Si no encontramos la columna RIT, no es la tabla correcta
    if (ritCol === -1) continue
    
    console.log(`  📋 Tabla encontrada: ${rows.length - 1} filas (RIT col: ${ritCol})`)
    
    // Procesar filas de datos (saltar header)
    for (let i = 1; i < rows.length; i++) {
      const cells = extractCells(rows[i])
      
      if (cells.length <= ritCol) continue
      
      const rit = cleanRIT(cells[ritCol])
      if (!rit) continue  // Saltar filas sin RIT válido
      
      const fechaAud = fechaAudCol >= 0 ? parseChileanDate(cells[fechaAudCol]) : null
      const fechaIng = fechaIngCol >= 0 ? parseChileanDate(cells[fechaIngCol]) : null
      const curador = curadorCol >= 0 ? cleanText(cells[curadorCol]) : ''
      
      asignaciones.push({
        rit,
        fecha_audiencia: fechaAud,
        fecha_ingreso: fechaIng,
        curador,
      })
    }
  }
  
  console.log(`  ✅ ${asignaciones.length} asignaciones extraídas`)
  
  return asignaciones
}

/**
 * Parsea las asignaciones desde TEXTO PLANO (sin tabla HTML).
 *
 * Hace falta porque cuando se copia un correo desde Outlook/Gmail y se pega, el contenido
 * NO siempre llega como `<table>`: a veces llega como líneas con tabulaciones o espacios.
 * Sin este respaldo, pegar el correo devolvería 0 asignaciones sin explicación.
 *
 * Estrategia por línea (tolerante al desorden de espacios):
 *  1. buscar un RIT en cualquier parte de la línea,
 *  2. buscar las fechas dd/mm/yyyy que haya,
 *  3. lo que sobra después de la última fecha se toma como el curador.
 *
 * El ORDEN de las fechas se deduce del encabezado si aparece (FECHA AUD / FECHA ING); si no
 * hay encabezado, se asume el formato del correo de la jefa: primero AUD, después ING.
 */
export function parseAsignacionesFromText(texto: string): AsignacionEmail[] {
  const asignaciones: AsignacionEmail[] = []
  if (!texto) return asignaciones

  // ¿El encabezado pone FECHA ING antes que FECHA AUD? (invierte el orden por defecto)
  const plano = texto.toUpperCase().replace(/\s+/g, ' ')
  const posAud = plano.search(/FECHA\s*AUD/)
  const posIng = plano.search(/FECHA\s*ING/)
  const ingresoPrimero = posIng >= 0 && posAud >= 0 && posIng < posAud

  // RIT en cualquier parte de la línea: letra + número + año, con guion normal o largo.
  const RE_RIT = /\b([A-Z])\s*[-–—]\s*(\d{1,6})\s*[-–—]\s*(\d{4})\b/i
  // Fechas dd/mm/yyyy, dd-mm-yyyy o dd.mm.yyyy
  const RE_FECHA = /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}\b/g

  for (const lineaRaw of texto.split(/\r?\n/)) {
    const linea = lineaRaw.replace(/\u00A0/g, ' ').trim()
    if (!linea) continue

    const mRit = linea.match(RE_RIT)
    if (!mRit) continue
    const rit = cleanRIT(`${mRit[1]}-${mRit[2]}-${mRit[3]}`)
    if (!rit) continue

    const fechas = linea.match(RE_FECHA) || []
    const f1 = fechas[0] ? parseChileanDate(fechas[0]) : null
    const f2 = fechas[1] ? parseChileanDate(fechas[1]) : null
    const fecha_audiencia = ingresoPrimero ? f2 : f1
    const fecha_ingreso = ingresoPrimero ? f1 : f2

    // Curador: lo que queda después de la última fecha (o después del RIT si no hay fechas).
    let resto = ''
    if (fechas.length > 0) {
      const ultima = fechas[fechas.length - 1]
      resto = linea.slice(linea.lastIndexOf(ultima) + ultima.length)
    } else {
      resto = linea.slice((mRit.index || 0) + mRit[0].length)
    }
    // Quitar separadores de celda (tabs, pipes, ;) y quedarse con el nombre.
    const curador = cleanText(resto.replace(/[|;\t]+/g, ' '))

    asignaciones.push({ rit, fecha_audiencia, fecha_ingreso, curador })
  }

  return asignaciones
}

/**
 * Punto de entrada ÚNICO para contenido pegado por la usuaria: intenta la tabla HTML y,
 * si no encuentra nada, cae al parseo de texto plano. Devuelve también `origen` para que la
 * pantalla pueda explicar de dónde salieron los datos (o por qué no salió nada).
 *
 * Además DEDUPLICA por RIT: si el correo repite un RIT (o se pega el hilo completo con el
 * mismo correo citado varias veces), la causa se procesa una sola vez. Se conserva la
 * primera aparición que tenga fecha de audiencia, que es la que importa.
 */
export function parseAsignaciones(contenido: string): {
  asignaciones: AsignacionEmail[]
  origen: 'tabla-html' | 'texto' | 'vacio'
} {
  const limpio = (contenido || '').trim()
  if (!limpio) return { asignaciones: [], origen: 'vacio' }

  let origen: 'tabla-html' | 'texto' | 'vacio' = 'tabla-html'
  let encontradas = parseAsignacionesFromHtml(limpio)

  if (encontradas.length === 0) {
    // Sin tabla HTML utilizable → probar como texto. Se quitan los tags para que el texto
    // quede legible si lo pegado era HTML pero sin una <table> reconocible.
    const comoTexto = /<[a-z][\s\S]*>/i.test(limpio) ? htmlATexto(limpio) : limpio
    encontradas = parseAsignacionesFromText(comoTexto)
    origen = encontradas.length > 0 ? 'texto' : 'vacio'
  }

  // Deduplicar por RIT conservando la entrada más completa.
  const porRit = new Map<string, AsignacionEmail>()
  for (const a of encontradas) {
    const previa = porRit.get(a.rit)
    if (!previa) { porRit.set(a.rit, a); continue }
    porRit.set(a.rit, {
      rit: a.rit,
      fecha_audiencia: previa.fecha_audiencia || a.fecha_audiencia,
      fecha_ingreso: previa.fecha_ingreso || a.fecha_ingreso,
      curador: previa.curador || a.curador,
    })
  }

  return { asignaciones: [...porRit.values()], origen }
}

/**
 * Convierte HTML a texto conservando los SALTOS DE LÍNEA por fila/celda. Importante: si se
 * usara stripHtml sobre todo el documento, las filas se pegarían en una sola línea gigante
 * y el parser de texto (que trabaja línea por línea) no encontraría nada.
 */
function htmlATexto(html: string): string {
  return html
    .replace(/<\/(tr|p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Extrae todas las tablas del HTML
 */
function extractTables(html: string): string[] {
  const tables: string[] = []
  const regex = /<table[^>]*>([\s\S]*?)<\/table>/gi
  let match
  
  while ((match = regex.exec(html)) !== null) {
    tables.push(match[0])
  }
  
  return tables
}

/**
 * Extrae filas (tr) de una tabla
 */
function extractRows(tableHtml: string): string[] {
  const rows: string[] = []
  const regex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let match
  
  while ((match = regex.exec(tableHtml)) !== null) {
    rows.push(match[0])
  }
  
  return rows
}

/**
 * Extrae celdas (td o th) de una fila
 */
function extractCells(rowHtml: string): string[] {
  const cells: string[] = []
  const regex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi
  let match
  
  while ((match = regex.exec(rowHtml)) !== null) {
    cells.push(stripHtml(match[1]))
  }
  
  return cells
}

/**
 * Encuentra el índice de una columna por posibles nombres
 */
function findColumnIndex(headers: string[], possibleNames: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    for (const name of possibleNames) {
      if (headers[i].includes(name)) return i
    }
  }
  return -1
}

/**
 * Limpia y valida un RIT
 * Acepta: "P-8141-2026", "P–8141–2026" (dash largo), "P- 8141-2026"
 */
function cleanRIT(raw: string): string | null {
  if (!raw) return null
  
  let clean = raw.trim()
    .replace(/\s+/g, '')        // Quitar espacios
    .replace(/–/g, '-')         // Dash largo → corto
    .replace(/—/g, '-')         // Em dash → corto
    .replace(/\u00A0/g, '')     // Non-breaking space
    .toUpperCase()
  
  // Validar formato: LETRA-NUMERO-AÑO
  const match = clean.match(/^([A-Z])-(\d{1,6})-(\d{4})$/)
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`
  }
  
  // Intentar formato sin guiones: P81412026
  const match2 = clean.match(/^([A-Z])(\d{1,6})(\d{4})$/)
  if (match2) {
    return `${match2[1]}-${match2[2]}-${match2[3]}`
  }
  
  return null
}

/**
 * Parsea fecha chilena (dd/mm/yyyy) a ISO (yyyy-mm-dd)
 */
function parseChileanDate(raw: string): string | null {
  if (!raw) return null
  
  const clean = raw.trim().replace(/\s+/g, '')
  
  // Formato dd/mm/yyyy o dd-mm-yyyy
  const match = clean.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (match) {
    const day = parseInt(match[1])
    const month = parseInt(match[2])
    const year = parseInt(match[3])
    
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2030) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  
  return null
}

/**
 * Quita tags HTML y decodifica entities
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Limpia texto general
 */
function cleanText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .trim()
}
