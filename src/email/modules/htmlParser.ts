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
