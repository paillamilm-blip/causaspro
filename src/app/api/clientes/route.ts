import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import type { ClienteInput } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/clientes
 * Lista los clientes con un resumen de sus causas y deuda.
 */
export async function GET() {
  try {
    const sb = createAdminClient()

    const { data: clientes, error } = await sb
      .from('clientes')
      .select('*')
      .order('nombre', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Contar causas por cliente
    const { data: causas } = await sb.from('causas').select('id, cliente_id').not('cliente_id', 'is', null)
    const causasPorCliente = new Map<string, number>()
    for (const c of causas || []) {
      if (c.cliente_id) causasPorCliente.set(c.cliente_id, (causasPorCliente.get(c.cliente_id) || 0) + 1)
    }

    const result = (clientes || []).map((c) => ({
      ...c,
      total_causas: causasPorCliente.get(c.id) || 0,
    }))

    return NextResponse.json({ ok: true, clientes: result })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * POST /api/clientes
 * Crea un cliente nuevo.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ClienteInput
    if (!body?.nombre?.trim()) {
      return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })
    }

    const sb = createAdminClient()
    const { data, error } = await sb
      .from('clientes')
      .insert({
        nombre: body.nombre.trim(),
        rut: body.rut || null,
        email: body.email || null,
        telefono: body.telefono || null,
        direccion: body.direccion || null,
        notas: body.notas || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, cliente: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * PATCH /api/clientes
 * Actualiza un cliente. Requiere { id, ...campos }.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...campos } = body
    if (!id) return NextResponse.json({ error: 'Falta el id del cliente' }, { status: 400 })

    const sb = createAdminClient()
    const { data, error } = await sb.from('clientes').update(campos).eq('id', id).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, cliente: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * DELETE /api/clientes?id=...
 * Elimina un cliente (las causas quedan sin cliente por ON DELETE SET NULL).
 */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Falta el id del cliente' }, { status: 400 })

    const sb = createAdminClient()
    const { error } = await sb.from('clientes').delete().eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
