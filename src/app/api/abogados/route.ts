import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import type { AbogadoInput } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/abogados
 * Lista abogados (con su estudio) y la lista de estudios.
 */
export async function GET() {
  try {
    const sb = createAdminClient()

    const [abogadosRes, estudiosRes] = await Promise.all([
      sb.from('abogados').select('*').eq('activo', true).order('nombre', { ascending: true }),
      sb.from('estudios').select('*').order('nombre', { ascending: true }),
    ])

    if (abogadosRes.error) return NextResponse.json({ error: abogadosRes.error.message }, { status: 500 })
    if (estudiosRes.error) return NextResponse.json({ error: estudiosRes.error.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      abogados: abogadosRes.data || [],
      estudios: estudiosRes.data || [],
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * POST /api/abogados
 * Crea un abogado. Puede crear el estudio al vuelo con { estudio_nombre }.
 * Body: AbogadoInput + { estudio_nombre? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AbogadoInput & { estudio_nombre?: string }
    if (!body?.nombre?.trim()) {
      return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })
    }
    if (body.rol && !['socio', 'abogado'].includes(body.rol)) {
      return NextResponse.json({ error: 'Rol invalido' }, { status: 400 })
    }

    const sb = createAdminClient()

    // Resolver estudio: usar el dado, o crear uno nuevo si viene estudio_nombre
    let estudioId = body.estudio_id ?? null
    if (!estudioId && body.estudio_nombre?.trim()) {
      const { data: estudio, error: estErr } = await sb
        .from('estudios')
        .insert({ nombre: body.estudio_nombre.trim() })
        .select()
        .single()
      if (estErr) return NextResponse.json({ error: estErr.message }, { status: 500 })
      estudioId = estudio.id
    }

    // Recordar si creamos el estudio en esta llamada (para limpiarlo si falla el abogado)
    const estudioCreadoAqui = !body.estudio_id && Boolean(body.estudio_nombre?.trim())

    const { data, error } = await sb
      .from('abogados')
      .insert({
        nombre: body.nombre.trim(),
        estudio_id: estudioId,
        rut: body.rut || null,
        email: body.email || null,
        rol: body.rol || 'abogado',
      })
      .select()
      .single()

    if (error) {
      // Si creamos un estudio al vuelo y el abogado fallo, no dejar estudio huerfano
      if (estudioCreadoAqui && estudioId) {
        await sb.from('estudios').delete().eq('id', estudioId)
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, abogado: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * PATCH /api/abogados
 * Actualiza un abogado (campos whitelisted). Requiere { id }.
 */
const CAMPOS_EDITABLES = ['nombre', 'rut', 'email', 'rol', 'estudio_id', 'activo'] as const

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body?.id) return NextResponse.json({ error: 'Falta el id del abogado' }, { status: 400 })

    const campos: Record<string, unknown> = {}
    for (const key of CAMPOS_EDITABLES) {
      if (key in body) campos[key] = body[key]
    }
    if ('rol' in campos && !['socio', 'abogado'].includes(String(campos.rol))) {
      return NextResponse.json({ error: 'Rol invalido' }, { status: 400 })
    }
    if (Object.keys(campos).length === 0) {
      return NextResponse.json({ error: 'No hay campos validos para actualizar' }, { status: 400 })
    }

    const sb = createAdminClient()
    const { data, error } = await sb.from('abogados').update(campos).eq('id', body.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, abogado: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
