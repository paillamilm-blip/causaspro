import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { validarReparto } from '@/lib/reparto'
import type { RepartoItemInput } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reparto?honorario_id=...
 * Devuelve el reparto actual de un honorario.
 */
export async function GET(req: NextRequest) {
  try {
    const honorarioId = req.nextUrl.searchParams.get('honorario_id')
    if (!honorarioId) return NextResponse.json({ error: 'Falta honorario_id' }, { status: 400 })

    const sb = createAdminClient()
    const { data, error } = await sb
      .from('reparto_honorarios')
      .select('*')
      .eq('honorario_id', honorarioId)
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, reparto: data || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * PUT /api/reparto
 * Reemplaza el reparto de un honorario (borra el previo e inserta el nuevo).
 * Body: { honorario_id, items: [{ abogado_id, porcentaje }] }
 * Valida que los porcentajes sumen 100%.
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const honorarioId: string | undefined = body?.honorario_id
    const items: RepartoItemInput[] = body?.items || []

    if (!honorarioId) return NextResponse.json({ error: 'Falta honorario_id' }, { status: 400 })

    const validacion = validarReparto(items)
    if (!validacion.ok) return NextResponse.json({ error: validacion.error }, { status: 400 })

    const sb = createAdminClient()

    // Verificar que el honorario existe
    const { data: hon, error: honErr } = await sb
      .from('honorarios')
      .select('id')
      .eq('id', honorarioId)
      .maybeSingle()
    if (honErr) return NextResponse.json({ error: honErr.message }, { status: 500 })
    if (!hon) return NextResponse.json({ error: 'Honorario no encontrado' }, { status: 404 })

    // Verificar que todos los abogados del reparto existen Y estan activos.
    // (Repartir a un abogado inactivo haria "desaparecer" ese monto de la vista
    // v_cartera_abogado, que filtra a.activo = TRUE.)
    const abogadoIds = items.map((it) => it.abogado_id)
    const { data: abogadosOk, error: abErr } = await sb
      .from('abogados')
      .select('id')
      .eq('activo', true)
      .in('id', abogadoIds)
    if (abErr) return NextResponse.json({ error: abErr.message }, { status: 500 })
    if ((abogadosOk?.length || 0) !== new Set(abogadoIds).size) {
      return NextResponse.json(
        { error: 'Uno o mas abogados del reparto no existen o estan inactivos' },
        { status: 400 }
      )
    }

    // Reemplazo conservador: primero borro el previo, luego inserto el nuevo.
    // Ya validamos que abogados existen y que suma 100%, asi que el insert no
    // deberia fallar por datos. (El Paso 2 movera esto a un RPC transaccional.)
    const { error: delErr } = await sb.from('reparto_honorarios').delete().eq('honorario_id', honorarioId)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    const records = items.map((it) => ({
      honorario_id: honorarioId,
      abogado_id: it.abogado_id,
      porcentaje: it.porcentaje,
    }))
    const { data, error } = await sb.from('reparto_honorarios').insert(records).select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, reparto: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
