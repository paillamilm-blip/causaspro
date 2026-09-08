import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cuotas/por-cobrar  (via ?vista=por_cobrar)
 * Lista las cuotas pendientes/vencidas con datos de cliente y causa.
 */
export async function GET(req: NextRequest) {
  try {
    const sb = createAdminClient()
    const vista = req.nextUrl.searchParams.get('vista')

    if (vista === 'por_cobrar') {
      const { data, error } = await sb.from('v_cuotas_por_cobrar').select('*')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, cuotas: data || [] })
    }

    const honorarioId = req.nextUrl.searchParams.get('honorario_id')
    if (!honorarioId) return NextResponse.json({ error: 'Falta honorario_id o vista' }, { status: 400 })

    const { data, error } = await sb
      .from('cuotas')
      .select('*')
      .eq('honorario_id', honorarioId)
      .order('numero', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, cuotas: data || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * PATCH /api/cuotas
 * Marca una cuota como pagada (o registra pago parcial).
 * Body: { id, pagada?, monto_pagado?, fecha_pago?, metodo_pago?, notas? }
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, accion, ...campos } = body
    if (!id) return NextResponse.json({ error: 'Falta el id de la cuota' }, { status: 400 })

    const sb = createAdminClient()

    // Atajo: accion = 'pagar' marca la cuota completa como pagada hoy
    if (accion === 'pagar') {
      // Verificar que la cuota existe ANTES de marcarla pagada (evita pagos en $0)
      const { data: cuota, error: findErr } = await sb.from('cuotas').select('monto').eq('id', id).maybeSingle()
      if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })
      if (!cuota) return NextResponse.json({ error: 'Cuota no encontrada' }, { status: 404 })

      const hoy = new Date().toISOString().slice(0, 10)
      const { data, error } = await sb
        .from('cuotas')
        .update({
          pagada: true,
          monto_pagado: cuota.monto,
          fecha_pago: hoy,
          metodo_pago: campos.metodo_pago ?? 'transferencia',
        })
        .eq('id', id)
        .select()
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, cuota: data })
    }

    // Atajo: accion = 'reabrir' revierte el pago
    if (accion === 'reabrir') {
      const { data, error } = await sb
        .from('cuotas')
        .update({ pagada: false, monto_pagado: 0, fecha_pago: null, metodo_pago: null })
        .eq('id', id)
        .select()
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, cuota: data })
    }

    // Actualizacion generica: solo campos de la lista blanca
    const CAMPOS_EDITABLES_CUOTA = [
      'monto',
      'fecha_vencimiento',
      'pagada',
      'fecha_pago',
      'monto_pagado',
      'metodo_pago',
      'notas',
      'ultimo_recordatorio',
    ]
    const limpio: Record<string, unknown> = {}
    for (const key of CAMPOS_EDITABLES_CUOTA) {
      if (key in campos) limpio[key] = campos[key]
    }
    if (Object.keys(limpio).length === 0) {
      return NextResponse.json({ error: 'No hay campos validos para actualizar' }, { status: 400 })
    }

    const { data, error } = await sb.from('cuotas').update(limpio).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, cuota: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
