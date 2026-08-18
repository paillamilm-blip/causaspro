import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { parseExcelRows } from '@/lib/parseExcel'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/upload
 * Recibe rows parseados desde el frontend (JSON)
 * Esto evita el límite de 4.5MB de Vercel para archivos
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''
    
    let parseResult
    
    if (contentType.includes('application/json')) {
      // NUEVO: Recibe JSON con rows ya parseados en el frontend
      const body = await req.json()
      const { rows, sheetName } = body
      
      if (!rows || !Array.isArray(rows) || rows.length < 2) {
        return NextResponse.json({ error: 'Datos inválidos o archivo vacío' }, { status: 400 })
      }
      
      try {
        parseResult = parseExcelRows(rows, sheetName || 'Hoja1')
      } catch (parseErr: any) {
        return NextResponse.json({ error: `Error procesando datos: ${parseErr.message}` }, { status: 400 })
      }
      
    } else {
      // LEGACY: Recibe archivo directo (FormData) — para archivos pequeños
      const formData = await req.formData()
      const file = formData.get('file') as File
      
      if (!file) {
        return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
      }
      
      if (file.size > 4 * 1024 * 1024) {
        return NextResponse.json({ 
          error: `Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: 4MB.` 
        }, { status: 400 })
      }

      const { parseExcelBuffer } = await import('@/lib/parseExcel')
      const buffer = await file.arrayBuffer()
      
      try {
        parseResult = parseExcelBuffer(buffer)
      } catch (parseErr: any) {
        return NextResponse.json({ error: `Error al leer archivo: ${parseErr.message}` }, { status: 400 })
      }
    }
    
    const { causas, nna, adultos, audiencias } = parseResult

    if (causas.length === 0) {
      return NextResponse.json({ 
        error: 'No se encontraron causas. ¿El archivo tiene una columna con RIT (ej: P-1234-2024)?',
        columnasEncontradas: parseResult.columnasDetectadas,
      }, { status: 400 })
    }

    const supabase = createAdminClient()

    // 1. Verificar cuáles RIT ya existen
    const rits = causas.map(c => c.rit)
    const existingRitMap: Record<string, string> = {}
    
    for (let i = 0; i < rits.length; i += 100) {
      const batch = rits.slice(i, i + 100)
      const { data } = await supabase.from('causas').select('id, rit').in('rit', batch)
      for (const c of data || []) {
        existingRitMap[c.rit] = c.id
      }
    }

    const causasNuevas = causas.filter(c => !existingRitMap[c.rit])
    const causasExistentes = causas.filter(c => existingRitMap[c.rit])

    // 2. Insertar causas nuevas
    const ritToId: Record<string, string> = { ...existingRitMap }
    let causasInsertadas = 0

    if (causasNuevas.length > 0) {
      const insertData = causasNuevas.map(c => ({
        rit: c.rit,
        caratulado: c.caratulado || null,
        tipo: c.tipo || null,
        fecha_apertura: isValidDate(c.fecha_apertura) ? c.fecha_apertura : null,
        sintesis: c.sintesis || null,
        estado: c.estado || null,
        programa_vigente: c.programa_vigente || null,
        saj: c.saj || null,
        notas: c.notas || null,
        datos_extra: sanitizeJson(c.datos_extra) || {},
        columnas_origen: c.columnas_origen || [],
      }))

      for (let i = 0; i < insertData.length; i += 50) {
        const batch = insertData.slice(i, i + 50)
        const { data, error } = await supabase.from('causas').insert(batch).select('id, rit')

        if (error) {
          // Si falla el batch, intentar uno por uno
          for (const single of batch) {
            const { data: sd } = await supabase.from('causas').insert(single).select('id, rit')
            if (sd) {
              for (const c of sd) { ritToId[c.rit] = c.id }
              causasInsertadas += sd.length
            }
          }
        } else if (data) {
          for (const c of data) { ritToId[c.rit] = c.id }
          causasInsertadas += data.length
        }
      }
    }

    // 3. Actualizar existentes
    let causasActualizadas = 0
    for (const c of causasExistentes) {
      const update: Record<string, any> = { updated_at: new Date().toISOString() }
      if (c.estado) update.estado = c.estado
      if (c.programa_vigente) update.programa_vigente = c.programa_vigente
      if (c.datos_extra) update.datos_extra = sanitizeJson(c.datos_extra)
      if (c.columnas_origen) update.columnas_origen = c.columnas_origen
      
      const { error } = await supabase.from('causas').update(update).eq('rit', c.rit)
      if (!error) causasActualizadas++
    }

    // 4. NNA
    let nnaCount = 0
    const nnaRecords = nna
      .filter(n => ritToId[n._rit])
      .map(n => ({ ...n, causa_id: ritToId[n._rit], _rit: undefined, fecha_nacimiento: isValidDate(n.fecha_nacimiento) ? n.fecha_nacimiento : null }))
      .map(({ _rit, ...rest }) => rest)

    for (let i = 0; i < nnaRecords.length; i += 100) {
      const batch = nnaRecords.slice(i, i + 100)
      const { data } = await supabase.from('nna').insert(batch).select('id')
      nnaCount += data?.length || 0
    }

    // 5. Adultos
    let adultosCount = 0
    const adultosRecords = adultos
      .filter(a => ritToId[a._rit])
      .map(({ _rit, ...rest }) => ({ ...rest, causa_id: ritToId[_rit] }))

    for (let i = 0; i < adultosRecords.length; i += 100) {
      const batch = adultosRecords.slice(i, i + 100)
      const { data } = await supabase.from('adultos').insert(batch).select('id')
      adultosCount += data?.length || 0
    }

    // 6. Audiencias
    let audienciasCount = 0
    const audienciasRecords = audiencias
      .filter(a => ritToId[a._rit] && a.fecha && isValidDate(a.fecha))
      .map(a => ({ causa_id: ritToId[a._rit], fecha: a.fecha!, tipo: 'audiencia' }))

    for (let i = 0; i < audienciasRecords.length; i += 100) {
      const batch = audienciasRecords.slice(i, i + 100)
      const { data } = await supabase.from('audiencias').insert(batch).select('id')
      audienciasCount += data?.length || 0
    }

    return NextResponse.json({
      ok: true,
      stats: {
        causas: causasInsertadas,
        causas_actualizadas: causasActualizadas,
        nna: nnaCount,
        adultos: adultosCount,
        audiencias: audienciasCount,
        columnasDetectadas: parseResult.columnasDetectadas || [],
        hoja: parseResult.hoja || '',
        totalFilas: parseResult.totalFilas,
      }
    })

  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: `Error: ${err.message || 'Error interno'}` }, { status: 500 })
  }
}

function isValidDate(dateStr: string | undefined | null): boolean {
  if (!dateStr) return false
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return false
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  const year = d.getFullYear()
  return year >= 1900 && year <= 2030
}

function sanitizeJson(obj: Record<string, any> | undefined): Record<string, any> {
  if (!obj) return {}
  const clean: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    if (value instanceof Date) {
      if (!isNaN(value.getTime())) clean[key] = value.toISOString().split('T')[0]
    } else if (typeof value === 'number') {
      if (!isNaN(value) && isFinite(value)) clean[key] = value
    } else if (typeof value === 'string') {
      const t = value.trim()
      if (t && t.toLowerCase() !== 'nan' && t.toLowerCase() !== 'none') clean[key] = t
    } else {
      clean[key] = String(value)
    }
  }
  return clean
}
