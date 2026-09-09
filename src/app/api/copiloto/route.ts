import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { interpretarMovimiento, ordenarDecisiones, diasHabilesHasta, type Decision } from '@/lib/copiloto'
import { enriquecerDecision, isAIEnabled } from '@/lib/aiClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Decision de una causa (decision + contexto de la causa/movimiento). */
interface DecisionCausa extends Decision {
  causa_id: string
  rit: string | null
  caratulado: string | null
  movimiento_fecha: string | null
  dias_restantes: number | null
}

/**
 * GET /api/copiloto?dias=15&ia=1
 * Arma la lista de decisiones del dia a partir de los movimientos recientes.
 * - dias: ventana de movimientos a considerar (default 15)
 * - ia=1: intenta enriquecer con IA las decisiones criticas (si hay key)
 */
export async function GET(req: NextRequest) {
  try {
    const sb = createAdminClient()
    const dias = Number(req.nextUrl.searchParams.get('dias')) || 15
    const usarIA = req.nextUrl.searchParams.get('ia') === '1' && isAIEnabled()

    const desde = new Date()
    desde.setDate(desde.getDate() - dias)
    const desdeIso = desde.toISOString().slice(0, 10)

    // Movimientos recientes con datos de su causa
    const { data: movimientos, error } = await sb
      .from('movimientos')
      .select('id, causa_id, fecha, tramite, descripcion, etapa, causas(rit, caratulado)')
      .gte('fecha', desdeIso)
      .order('fecha', { ascending: false })
      .limit(200)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Interpretar cada movimiento (heuristico)
    let decisiones: DecisionCausa[] = (movimientos || []).map((m: any) => {
      const d = interpretarMovimiento({
        tramite: m.tramite,
        descripcion: m.descripcion,
        etapa: m.etapa,
        fecha: m.fecha,
      })
      const causa = Array.isArray(m.causas) ? m.causas[0] : m.causas
      return {
        ...d,
        causa_id: m.causa_id,
        rit: causa?.rit ?? null,
        caratulado: causa?.caratulado ?? null,
        movimiento_fecha: m.fecha,
        dias_restantes: d.fechaLimite ? diasHabilesHasta(d.fechaLimite) : null,
      }
    })

    // Filtrar el ruido "informativo" para dejar solo lo accionable
    decisiones = decisiones.filter((d) => d.prioridad !== 'informativo')
    decisiones = ordenarDecisiones(decisiones)

    // Enriquecer con IA solo las criticas (para no gastar cuota de mas)
    if (usarIA) {
      const criticas = decisiones.filter((d) => d.prioridad === 'critico').slice(0, 8)
      await Promise.all(
        criticas.map(async (d) => {
          const mejora = await enriquecerDecision(
            { tramite: d.titulo, descripcion: d.explicacion },
            d
          )
          if (mejora) {
            if (mejora.titulo) d.titulo = mejora.titulo
            if (mejora.explicacion) d.explicacion = mejora.explicacion
            if (mejora.accion) d.accion = mejora.accion
            if (mejora.riesgo) d.riesgo = mejora.riesgo
            d.fuente = 'ia'
          }
        })
      )
    }

    return NextResponse.json({
      ok: true,
      ia_disponible: isAIEnabled(),
      ia_usada: usarIA,
      total: decisiones.length,
      decisiones,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * POST /api/copiloto
 * Interpreta UN movimiento puntual (para "explicame este movimiento").
 * Body: { tramite, descripcion?, etapa?, fecha?, ia?: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body?.tramite) return NextResponse.json({ error: 'Falta el tramite' }, { status: 400 })

    const decision = interpretarMovimiento({
      tramite: body.tramite,
      descripcion: body.descripcion,
      etapa: body.etapa,
      fecha: body.fecha,
    })

    if (body.ia && isAIEnabled()) {
      const mejora = await enriquecerDecision(body, decision)
      if (mejora) {
        if (mejora.titulo) decision.titulo = mejora.titulo
        if (mejora.explicacion) decision.explicacion = mejora.explicacion
        if (mejora.accion) decision.accion = mejora.accion
        if (mejora.riesgo) decision.riesgo = mejora.riesgo
        decision.fuente = 'ia'
      }
    }

    return NextResponse.json({ ok: true, decision })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
