// ============================================================
// CAUSASPRO - API: minuta de audiencia de revisión (.docx) de una causa
// ------------------------------------------------------------
// GET /api/minuta/<causaId>  → descarga un .docx con la MINUTA DE AUDIENCIA
// DE REVISIÓN en el formato estricto de la curaduría.
//
// Salida NUEVA e INDEPENDIENTE del reporte (/api/reporte/[id]). Precarga solo
// datos objetivos (RIT + nombre/edad de NNA); el resto del formato queda en
// blanco para completar a mano. Mismo mecanismo de autorización por token que
// el reporte, porque incluye PII de menores (nombres/edad de NNA).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { generarMinutaAudiencia, nombreArchivoMinuta, type MinutaData } from '@/lib/minutaAudiencia'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Misma política de autorización que /api/reporte: fail-closed si no hay ningún
 * token configurado. Acepta el token público del frontend (NEXT_PUBLIC_REPORTE_TOKEN)
 * o un token de servicio (REPORTE_API_TOKEN / BOT_API_TOKEN / service role).
 */
function estaAutorizado(req: NextRequest): boolean {
  const header = req.headers.get('authorization') || ''
  const url = new URL(req.url)
  const qToken = url.searchParams.get('token') || ''

  const tokenPublico = process.env.NEXT_PUBLIC_REPORTE_TOKEN
  if (tokenPublico && qToken && qToken === tokenPublico) return true

  const esperado = process.env.REPORTE_API_TOKEN
    || process.env.BOT_API_TOKEN
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!esperado) return false
  const min = esperado.slice(0, 20)
  return header.includes(min) || qToken === esperado || qToken.slice(0, 20) === min
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const causaId = params.id
  if (!causaId) {
    return NextResponse.json({ error: 'Falta el id de la causa' }, { status: 400 })
  }

  let sb
  try {
    sb = createAdminClient()
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Supabase no configurado' }, { status: 500 })
  }

  // Solo necesitamos datos objetivos: RIT de la causa + nombre/edad de los NNA.
  const [cRes, nnaRes] = await Promise.all([
    sb.from('causas').select('rit').eq('id', causaId).single(),
    sb.from('nna').select('nombre, apellido, edad').eq('causa_id', causaId),
  ])

  if (cRes.error || !cRes.data) {
    return NextResponse.json({ error: 'Causa no encontrada' }, { status: 404 })
  }

  const data: MinutaData = {
    causa: { rit: (cRes.data as any).rit },
    nna: (nnaRes.data || []) as MinutaData['nna'],
  }

  try {
    const buffer = await generarMinutaAudiencia(data)
    const filename = nombreArchivoMinuta(data.causa.rit)
    const body = new Uint8Array(buffer)
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'No se pudo generar la minuta: ' + (e?.message || e) }, { status: 500 })
  }
}
