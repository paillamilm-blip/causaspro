import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// POST /api/ranking/refresh  → recalcula la vista materializada mv_causas_ranking.
//
// El semáforo vive en una MATERIALIZED VIEW (precalculada) para que el dashboard sea
// instantáneo. Esos datos NO se actualizan solos: hay que refrescarlos cuando el bot
// carga movimientos/audiencias nuevos. Este endpoint dispara ese refresh.
//
// Llamar desde el pipeline del bot al terminar una corrida, o manualmente.
// Fail-closed con token (mismo patrón que /api/reporte/[id] y /api/ranking).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function estaAutorizado(req: NextRequest): boolean {
  const header = req.headers.get('authorization') || ''
  const url = new URL(req.url)
  const qToken = url.searchParams.get('token') || ''
  const esperado = process.env.REPORTE_API_TOKEN
    || process.env.BOT_API_TOKEN
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!esperado) return false // fail-closed
  const min = esperado.slice(0, 20)
  return header.includes(min) || qToken === esperado || qToken.slice(0, 20) === min
}

export async function POST(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const admin = createAdminClient()
    // CONCURRENTLY: no bloquea las lecturas del dashboard mientras recalcula.
    // Requiere el índice único idx_mv_causas_ranking_id (creado en schema-vista-materializada.sql).
    const { error } = await admin.rpc('refresh_ranking')
    if (error) {
      return NextResponse.json({ error: error.message, code: (error as any).code ?? null }, { status: 500 })
    }
    return NextResponse.json({ ok: true, refreshed_at: new Date().toISOString() }, { status: 200 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error interno' }, { status: 500 })
  }
}
