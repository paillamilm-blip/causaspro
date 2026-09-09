import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { generarPlanCuotas, calcularMontoPactado } from '@/lib/finanzas'
import type { HonorarioInput } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/honorarios?causa_id=...
 * Devuelve el honorario de una causa (con su resumen y cuotas).
 * Sin causa_id: devuelve todos los resumenes.
 */
export async function GET(req: NextRequest) {
  try {
    const sb = createAdminClient()
    const causaId = req.nextUrl.searchParams.get('causa_id')

    if (causaId) {
      const { data: honorario, error } = await sb
        .from('honorarios')
        .select('*')
        .eq('causa_id', causaId)
        .neq('estado', 'anulado')
        .maybeSingle()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!honorario) return NextResponse.json({ ok: true, honorario: null, cuotas: [] })

      const { data: cuotas } = await sb
        .from('cuotas')
        .select('*')
        .eq('honorario_id', honorario.id)
        .order('numero', { ascending: true })

      const { data: resumen } = await sb
        .from('v_honorarios_resumen')
        .select('*')
        .eq('id', honorario.id)
        .maybeSingle()

      return NextResponse.json({ ok: true, honorario, cuotas: cuotas || [], resumen: resumen || null })
    }

    const { data, error } = await sb.from('v_honorarios_resumen').select('*')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, resumenes: data || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * POST /api/honorarios
 * Crea/reemplaza el honorario de una causa y, opcionalmente, genera el plan de cuotas.
 * Body: HonorarioInput + { num_cuotas?, primera_fecha?, frecuencia_dias? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as HonorarioInput & {
      num_cuotas?: number
      primera_fecha?: string | null
      frecuencia_dias?: number
    }

    if (!body?.causa_id) return NextResponse.json({ error: 'Falta causa_id' }, { status: 400 })
    if (!body?.modalidad) return NextResponse.json({ error: 'Falta la modalidad' }, { status: 400 })

    const sb = createAdminClient()

    // Guardar los honorarios activos previos por si hay que revertir la anulacion.
    const { data: previos } = await sb
      .from('honorarios')
      .select('id')
      .eq('causa_id', body.causa_id)
      .eq('estado', 'activo')
    const idsPrevios = (previos || []).map((h) => h.id)

    // Anular honorarios activos previos de la misma causa (mantiene historial)
    // y limpiar sus cuotas pendientes para que no sigan contando en la cobranza.
    if (idsPrevios.length > 0) {
      await sb.from('cuotas').delete().in('honorario_id', idsPrevios).eq('pagada', false)
      await sb.from('honorarios').update({ estado: 'anulado' }).in('id', idsPrevios)
    }

    // Si no viene cliente_id, heredar el de la causa
    let clienteId = body.cliente_id ?? null
    if (!clienteId) {
      const { data: causa } = await sb.from('causas').select('cliente_id').eq('id', body.causa_id).maybeSingle()
      clienteId = causa?.cliente_id ?? null
    }

    const { data: honorario, error } = await sb
      .from('honorarios')
      .insert({
        causa_id: body.causa_id,
        cliente_id: clienteId,
        modalidad: body.modalidad,
        monto_total: body.monto_total ?? 0,
        porcentaje_exito: body.porcentaje_exito ?? 0,
        monto_ganado: body.monto_ganado ?? 0,
        descripcion: body.descripcion ?? null,
        estado: 'activo',
      })
      .select()
      .single()

    if (error || !honorario) {
      // Revertir: reactivar los honorarios que se anularon (best-effort).
      if (idsPrevios.length > 0) {
        await sb.from('honorarios').update({ estado: 'activo' }).in('id', idsPrevios)
      }
      return NextResponse.json({ error: error?.message || 'No se pudo crear el honorario' }, { status: 500 })
    }

    // Generar plan de cuotas si se pidio
    if (body.num_cuotas && body.num_cuotas > 0) {
      const montoPactado = calcularMontoPactado(honorario)
      const plan = generarPlanCuotas(
        montoPactado,
        body.num_cuotas,
        body.primera_fecha ?? null,
        body.frecuencia_dias ?? 30
      )
      const records = plan.map((c) => ({
        honorario_id: honorario.id,
        numero: c.numero,
        monto: c.monto,
        fecha_vencimiento: c.fecha_vencimiento,
      }))
      const { error: cuotasErr } = await sb.from('cuotas').insert(records)
      if (cuotasErr) {
        // Revertir: eliminar el honorario recien creado (sus cuotas caen por CASCADE)
        // y reactivar los anteriores para no dejar la causa sin honorario activo.
        await sb.from('honorarios').delete().eq('id', honorario.id)
        if (idsPrevios.length > 0) {
          await sb.from('honorarios').update({ estado: 'activo' }).in('id', idsPrevios)
        }
        return NextResponse.json({ error: cuotasErr.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true, honorario })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * PATCH /api/honorarios
 * Actualiza campos EDITABLES de un honorario. Requiere { id, ...campos }.
 * Solo se aceptan columnas de una lista blanca (evita reasignar causa/cliente,
 * pisar timestamps o forzar el estado a mano).
 * Nota: para cambiar montos y regenerar el plan de cuotas, usar el POST (re-pacto).
 */
const CAMPOS_EDITABLES_HONORARIO = [
  'modalidad',
  'monto_total',
  'porcentaje_exito',
  'monto_ganado',
  'descripcion',
  'estado',
] as const

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id } = body
    if (!id) return NextResponse.json({ error: 'Falta el id del honorario' }, { status: 400 })

    // Solo permitir el subconjunto seguro de campos (whitelist)
    const campos: Record<string, unknown> = {}
    for (const key of CAMPOS_EDITABLES_HONORARIO) {
      if (key in body) campos[key] = body[key]
    }
    // estado solo puede tomar valores validos
    if ('estado' in campos && !['activo', 'cerrado', 'anulado'].includes(String(campos.estado))) {
      return NextResponse.json({ error: 'Estado invalido' }, { status: 400 })
    }
    if (Object.keys(campos).length === 0) {
      return NextResponse.json({ error: 'No hay campos validos para actualizar' }, { status: 400 })
    }

    const sb = createAdminClient()
    const { data, error } = await sb.from('honorarios').update(campos).eq('id', id).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, honorario: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
