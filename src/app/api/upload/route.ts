import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { parseExcelBuffer } from '@/lib/parseExcel'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel: max 60 segundos

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    
    let parseResult
    try {
      parseResult = parseExcelBuffer(buffer)
    } catch (parseErr: any) {
      return NextResponse.json({ 
        error: `Error al leer el archivo: ${parseErr.message}` 
      }, { status: 400 })
    }
    
    const { causas, nna, adultos, audiencias } = parseResult

    if (causas.length === 0) {
      return NextResponse.json({ 
        error: 'No se encontraron causas en el archivo. Asegúrate de que tenga una columna con RIT (ej: P-1234-2024).',
        columnasEncontradas: parseResult.columnasDetectadas,
      }, { status: 400 })
    }

    const supabase = createAdminClient()

    // 1. Verificar cuáles RIT ya existen
    const rits = causas.map(c => c.rit)
    
    // Buscar en lotes de 100 (Supabase tiene límite en IN)
    const existingRitMap: Record<string, string> = {}
    for (let i = 0; i < rits.length; i += 100) {
      const batch = rits.slice(i, i + 100)
      const { data: existingCausas } = await supabase
        .from('causas')
        .select('id, rit')
        .in('rit', batch)
      
      for (const c of existingCausas || []) {
        existingRitMap[c.rit] = c.id
      }
    }

    const causasNuevas = causas.filter(c => !existingRitMap[c.rit])
    const causasExistentes = causas.filter(c => existingRitMap[c.rit])

    // 2. Insertar causas nuevas
    const ritToId: Record<string, string> = { ...existingRitMap }
    let causasInsertadas = 0

    if (causasNuevas.length > 0) {
      // Preparar datos - limpiar fechas inválidas y serializar datos_extra
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

      // Insertar en lotes de 100
      for (let i = 0; i < insertData.length; i += 100) {
        const batch = insertData.slice(i, i + 100)
        const { data: causasData, error: causasErr } = await supabase
          .from('causas')
          .insert(batch)
          .select('id, rit')

        if (causasErr) {
          console.error('Error causas batch:', causasErr)
          // Si falla el batch, intentar uno por uno
          for (const single of batch) {
            const { data: singleData, error: singleErr } = await supabase
              .from('causas')
              .insert(single)
              .select('id, rit')
            
            if (!singleErr && singleData) {
              for (const c of singleData) {
                ritToId[c.rit] = c.id
              }
              causasInsertadas += singleData.length
            }
          }
        } else {
          for (const c of causasData || []) {
            ritToId[c.rit] = c.id
          }
          causasInsertadas += causasData?.length || 0
        }
      }
    }

    // 3. Actualizar causas existentes
    let causasActualizadas = 0
    for (const c of causasExistentes) {
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString(),
      }
      if (c.estado) updateData.estado = c.estado
      if (c.programa_vigente) updateData.programa_vigente = c.programa_vigente
      if (c.datos_extra) updateData.datos_extra = sanitizeJson(c.datos_extra)
      if (c.columnas_origen) updateData.columnas_origen = c.columnas_origen
      
      const { error } = await supabase
        .from('causas')
        .update(updateData)
        .eq('rit', c.rit)
      
      if (!error) causasActualizadas++
    }

    // 4. Insertar NNA
    let nnaCount = 0
    const nnaRecords = nna
      .filter(n => ritToId[n._rit])
      .map(n => {
        const { _rit, ...rest } = n
        return { 
          ...rest, 
          causa_id: ritToId[_rit],
          fecha_nacimiento: isValidDate(rest.fecha_nacimiento) ? rest.fecha_nacimiento : null,
        }
      })

    if (nnaRecords.length > 0) {
      for (let i = 0; i < nnaRecords.length; i += 100) {
        const batch = nnaRecords.slice(i, i + 100)
        const { data } = await supabase.from('nna').insert(batch).select('id')
        nnaCount += data?.length || 0
      }
    }

    // 5. Insertar adultos
    let adultosCount = 0
    const adultosRecords = adultos
      .filter(a => ritToId[a._rit])
      .map(a => {
        const { _rit, ...rest } = a
        return { ...rest, causa_id: ritToId[_rit] }
      })

    if (adultosRecords.length > 0) {
      for (let i = 0; i < adultosRecords.length; i += 100) {
        const batch = adultosRecords.slice(i, i + 100)
        const { data } = await supabase.from('adultos').insert(batch).select('id')
        adultosCount += data?.length || 0
      }
    }

    // 6. Insertar audiencias
    let audienciasCount = 0
    const audienciasRecords = audiencias
      .filter(a => ritToId[a._rit] && a.fecha && isValidDate(a.fecha))
      .map(a => ({
        causa_id: ritToId[a._rit],
        fecha: a.fecha!,
        tipo: 'audiencia',
      }))

    if (audienciasRecords.length > 0) {
      for (let i = 0; i < audienciasRecords.length; i += 100) {
        const batch = audienciasRecords.slice(i, i + 100)
        const { data } = await supabase.from('audiencias').insert(batch).select('id')
        audienciasCount += data?.length || 0
      }
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
    return NextResponse.json({ 
      error: `Error procesando archivo: ${err.message || 'Error interno del servidor'}` 
    }, { status: 500 })
  }
}

/**
 * Valida que una fecha string sea válida para PostgreSQL
 */
function isValidDate(dateStr: string | undefined | null): boolean {
  if (!dateStr) return false
  // Debe ser formato yyyy-mm-dd
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return false
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  // Rango razonable
  const year = d.getFullYear()
  return year >= 1900 && year <= 2030
}

/**
 * Limpia un objeto JSON para asegurar que sea serializable
 * (sin objetos Date, sin undefined, sin NaN)
 */
function sanitizeJson(obj: Record<string, any> | undefined): Record<string, any> {
  if (!obj) return {}
  const clean: Record<string, any> = {}
  
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue
    if (value instanceof Date) {
      if (!isNaN(value.getTime())) {
        clean[key] = value.toISOString().split('T')[0]
      }
    } else if (typeof value === 'number') {
      if (!isNaN(value) && isFinite(value)) {
        clean[key] = value
      }
    } else if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed && trimmed.toLowerCase() !== 'nan' && trimmed.toLowerCase() !== 'none') {
        clean[key] = trimmed
      }
    } else {
      clean[key] = String(value)
    }
  }
  
  return clean
}
