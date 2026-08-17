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

    // 1. Insertar causas
    const { data: causasData, error: causasErr } = await supabase
      .from('causas')
      .insert(causas)
      .select('id, rit')

    if (causasErr) {
      console.error('Error causas:', causasErr)
      return NextResponse.json({ error: `Error al insertar causas: ${causasErr.message}` }, { status: 500 })
    }

    // Mapa RIT → ID
    const ritToId: Record<string, string> = {}
    for (const c of causasData || []) {
      ritToId[c.rit] = c.id
    }

    // 2. Insertar NNA
    const nnaRecords = nna
      .filter(n => ritToId[n._rit])
      .map(n => {
        const { _rit, ...rest } = n
        return { ...rest, causa_id: ritToId[_rit] }
      })

    let nnaCount = 0
    if (nnaRecords.length > 0) {
      // Insertar en lotes de 200
      for (let i = 0; i < nnaRecords.length; i += 200) {
        const batch = nnaRecords.slice(i, i + 200)
        const { data } = await supabase.from('nna').insert(batch).select('id')
        nnaCount += data?.length || 0
      }
    }

    // 3. Insertar adultos
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

    // 4. Insertar audiencias
    const audienciasRecords = audiencias
      .filter(a => ritToId[a._rit] && a.fecha)
      .map(a => ({
        causa_id: ritToId[a._rit],
        fecha: a.fecha,
        tipo: 'audiencia',
      }))

    let audienciasCount = 0
    if (audienciasRecords.length > 0) {
      const { data } = await supabase.from('audiencias').insert(audienciasRecords).select('id')
      audienciasCount = data?.length || 0
    }

    return NextResponse.json({
      ok: true,
      stats: {
        causas: causasData?.length || 0,
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
