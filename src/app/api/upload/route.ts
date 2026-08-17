import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { parseExcelBuffer } from '@/lib/parseExcel'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    // Leer archivo
    const buffer = await file.arrayBuffer()
    
    // Parsear Excel
    const parseResult = parseExcelBuffer(buffer)
    const { causas, nna, adultos, audiencias } = parseResult

    if (causas.length === 0) {
      return NextResponse.json({ error: 'No se encontraron causas en el archivo. Asegúrate de que tenga una columna con RIT.' }, { status: 400 })
    }

    // Conectar a Supabase con service role
    const supabase = createAdminClient()

    // 1. Verificar cuáles RIT ya existen para evitar duplicados
    const rits = causas.map(c => c.rit)
    const { data: existingCausas } = await supabase
      .from('causas')
      .select('id, rit')
      .in('rit', rits)

    const existingRitMap: Record<string, string> = {}
    for (const c of existingCausas || []) {
      existingRitMap[c.rit] = c.id
    }

    // Separar causas nuevas de las que ya existen
    const causasNuevas = causas.filter(c => !existingRitMap[c.rit])
    const causasExistentes = causas.filter(c => existingRitMap[c.rit])

    // 2. Insertar solo causas nuevas
    const ritToId: Record<string, string> = { ...existingRitMap }
    let causasInsertadas = 0

    if (causasNuevas.length > 0) {
      const { data: causasData, error: causasErr } = await supabase
        .from('causas')
        .insert(causasNuevas)
        .select('id, rit')

      if (causasErr) {
        console.error('Error causas:', causasErr)
        return NextResponse.json({ error: `Error al insertar causas: ${causasErr.message}` }, { status: 500 })
      }

      for (const c of causasData || []) {
        ritToId[c.rit] = c.id
      }
      causasInsertadas = causasData?.length || 0
    }

    // 3. Actualizar causas existentes (refresh updated_at)
    for (const c of causasExistentes) {
      await supabase
        .from('causas')
        .update({
          estado: c.estado || undefined,
          programa_vigente: c.programa_vigente || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('rit', c.rit)
    }

    // 4. Insertar NNA (solo para causas que tenemos ID)
    const nnaRecords = nna
      .filter(n => ritToId[n._rit])
      .map(n => {
        const { _rit, ...rest } = n
        return { ...rest, causa_id: ritToId[_rit] }
      })

    let nnaCount = 0
    if (nnaRecords.length > 0) {
      for (let i = 0; i < nnaRecords.length; i += 200) {
        const batch = nnaRecords.slice(i, i + 200)
        const { data } = await supabase.from('nna').insert(batch).select('id')
        nnaCount += data?.length || 0
      }
    }

    // 5. Insertar adultos
    const adultosRecords = adultos
      .filter(a => ritToId[a._rit])
      .map(a => {
        const { _rit, ...rest } = a
        return { ...rest, causa_id: ritToId[_rit] }
      })

    let adultosCount = 0
    if (adultosRecords.length > 0) {
      for (let i = 0; i < adultosRecords.length; i += 200) {
        const batch = adultosRecords.slice(i, i + 200)
        const { data } = await supabase.from('adultos').insert(batch).select('id')
        adultosCount += data?.length || 0
      }
    }

    // 6. Insertar audiencias (evitar duplicados por fecha+causa)
    const audienciasRecords = audiencias
      .filter(a => ritToId[a._rit] && a.fecha)
      .map(a => ({
        causa_id: ritToId[a._rit],
        fecha: a.fecha,
        tipo: 'audiencia',
      }))

    let audienciasCount = 0
    if (audienciasRecords.length > 0) {
      // Insertar de a una para evitar crash por duplicados
      for (const aud of audienciasRecords) {
        const { data } = await supabase
          .from('audiencias')
          .insert(aud)
          .select('id')
        if (data && data.length > 0) audienciasCount++
      }
    }

    return NextResponse.json({
      ok: true,
      stats: {
        causas: causasInsertadas,
        causas_actualizadas: causasExistentes.length,
        nna: nnaCount,
        adultos: adultosCount,
        audiencias: audienciasCount,
        columnasDetectadas: parseResult.columnasDetectadas || [],
        hoja: parseResult.hoja || '',
      }
    })

  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 })
  }
}
