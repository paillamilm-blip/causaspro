// ============================================================
// CAUSASPRO - API: reporte Word (.docx) de una causa
// ------------------------------------------------------------
// GET /api/reporte/<causaId>  → descarga un .docx con el estado de la causa
// (cabecera, alertas, NNA, adultos, resoluciones y movimientos).
//
// Lee de Supabase con el cliente admin (server-side) y arma el documento con
// generarReporteWord (src/lib/reporteWord.ts). Corre en Node (no edge) porque
// la librería docx genera un Buffer.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { generarReporteWord, nombreArchivoReporte, type ReporteData } from '@/lib/reporteWord'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Verifica autorización. El reporte contiene PII sensible de causas de familia
 * (nombres/RUT/edad de NNA, teléfonos de adultos), así que NO puede quedar
 * abierto a cualquiera que conozca/adivine un id (IDOR). Se exige un token
 * REPORTE_API_TOKEN (o, por compatibilidad, BOT_API_TOKEN / service role) por
 * header Authorization o query ?token=. Mismo patrón que /api/bot.
 * Si NO hay ningún token configurado en el entorno, se BLOQUEA por defecto
 * (fail-closed) para no exponer datos por una mala configuración.
 */
function estaAutorizado(req: NextRequest): boolean {
  const header = req.headers.get('authorization') || ''
  const url = new URL(req.url)
  const qToken = url.searchParams.get('token') || ''

  // Token para el FRONTEND (público, va en el link de descarga). Es un secreto compartido
  // simple: no da acceso a la BD (a diferencia del service role), solo autoriza generar el
  // reporte. Debe configurarse en NEXT_PUBLIC_REPORTE_TOKEN.
  const tokenPublico = process.env.NEXT_PUBLIC_REPORTE_TOKEN
  if (tokenPublico && qToken && qToken === tokenPublico) return true

  // Token de servicio (para integraciones/servidor): REPORTE_API_TOKEN o el del bot.
  const esperado = process.env.REPORTE_API_TOKEN
    || process.env.BOT_API_TOKEN
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!esperado) {
    // Fail-closed SOLO si tampoco hay token público: sin ningún token configurado no
    // servimos PII por una mala configuración.
    return false
  }
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

  // Traer causa + relaciones en paralelo.
  const [cRes, movRes, nnaRes, adRes, audRes] = await Promise.all([
    sb.from('causas').select('*').eq('id', causaId).single(),
    sb.from('movimientos').select('fecha, etapa, tramite, descripcion, es_traslado_curador').eq('causa_id', causaId).order('fecha', { ascending: false }),
    sb.from('nna').select('nombre, apellido, edad, rut').eq('causa_id', causaId),
    sb.from('adultos').select('nombre, relacion, telefono').eq('causa_id', causaId),
    sb.from('audiencias').select('fecha, tipo').eq('causa_id', causaId).order('fecha', { ascending: true }),
  ])

  if (cRes.error || !cRes.data) {
    return NextResponse.json({ error: 'Causa no encontrada' }, { status: 404 })
  }

  const c: any = cRes.data
  // "tribunal" NO es una columna de `causas`. El bot suele guardarlo dentro de `notas`
  // (ej. "Tribunal: Centro de Medidas Cautelares. Institución: ..."). Se intenta extraer
  // de forma tolerante; si no aparece, queda null y el reporte muestra "—".
  const tribunalDeNotas = (() => {
    const m = String(c.notas || '').match(/tribunal\s*:\s*([^.\n]+)/i)
    return m ? m[1].trim() : null
  })()
  const data: ReporteData = {
    causa: {
      rit: c.rit,
      caratulado: c.caratulado,
      tipo: c.tipo,
      estado: c.estado,
      tribunal: c.datos_extra?.tribunal || tribunalDeNotas || null,
      programa_vigente: c.programa_vigente,
      sintesis: c.sintesis,
      fecha_apertura: c.fecha_apertura,
      updated_at: c.updated_at,
    },
    movimientos: (movRes.data || []) as ReporteData['movimientos'],
    nna: (nnaRes.data || []) as ReporteData['nna'],
    adultos: (adRes.data || []) as ReporteData['adultos'],
    audiencias: (audRes.data || []) as ReporteData['audiencias'],
    membrete: process.env.REPORTE_MEMBRETE || undefined,
  }

  try {
    const buffer = await generarReporteWord(data)
    const filename = nombreArchivoReporte(c.rit)
    // Uint8Array es un BodyInit válido (Buffer directo no tipa como BodyInit).
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
    return NextResponse.json({ error: 'No se pudo generar el reporte: ' + (e?.message || e) }, { status: 500 })
  }
}
