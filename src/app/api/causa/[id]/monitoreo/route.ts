// ============================================================
// CAUSASPRO - API: sacar / volver a poner una causa en monitoreo
// ------------------------------------------------------------
// POST /api/causa/<causaId>/monitoreo   body: { terminada: boolean }
//
// Se hace SERVER-SIDE (no desde el browser con el cliente de Supabase, como sí se guardan
// las gestiones) por dos razones:
//   1. `notas` es un canal COMPARTIDO con el bot y hay que leer-modificar-escribir para
//      agregar una línea sin pisar las marcas del bot. Hacerlo desde el cliente es una
//      condición de carrera.
//   2. No hace falta ampliar lo que el browser puede escribir sobre la tabla `causas`.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { marcarTerminada, desmarcarTerminada, estaTerminada } from '@/lib/monitoreo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Rate-limit simple en memoria: este endpoint ESCRIBE, así que se limita por IP.
const RATE_LIMIT = 30
const RATE_VENTANA_MS = 60_000
const _hits = new Map<string, number[]>()
function excedeRateLimit(ip: string): boolean {
  const ahora = Date.now()
  const previos = (_hits.get(ip) || []).filter((t) => ahora - t < RATE_VENTANA_MS)
  if (previos.length >= RATE_LIMIT) { _hits.set(ip, previos); return true }
  previos.push(ahora)
  _hits.set(ip, previos)
  return false
}

/** Autorización: mismo patrón que /api/analisis y /api/asignaciones. Fail-closed. */
function estaAutorizado(req: NextRequest): boolean {
  const header = req.headers.get('authorization') || ''
  const qToken = new URL(req.url).searchParams.get('token') || ''

  const tokenPublico = process.env.NEXT_PUBLIC_REPORTE_TOKEN
  if (tokenPublico && qToken && qToken === tokenPublico) return true

  const esperado = process.env.REPORTE_API_TOKEN
    || process.env.BOT_API_TOKEN
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!esperado) return false
  const min = esperado.slice(0, 20)
  return header.includes(min) || qToken === esperado || qToken.slice(0, 20) === min
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida'
  if (excedeRateLimit(ip)) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  const causaId = params.id
  if (!causaId) return NextResponse.json({ error: 'Falta el id de la causa' }, { status: 400 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo de la solicitud inválido.' }, { status: 400 })
  }
  if (typeof body?.terminada !== 'boolean') {
    return NextResponse.json({ error: 'Falta "terminada" (true para sacar de monitoreo, false para reactivar).' }, { status: 400 })
  }
  const quiereTerminar: boolean = body.terminada

  let sb
  try {
    sb = createAdminClient()
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Supabase no configurado' }, { status: 500 })
  }

  // Leer las notas actuales para AGREGAR/QUITAR una línea sin pisar las del bot.
  const { data: causa, error: errLeer } = await sb
    .from('causas')
    .select('rit, notas')
    .eq('id', causaId)
    .single()
  if (errLeer || !causa) {
    return NextResponse.json({ error: 'Causa no encontrada' }, { status: 404 })
  }

  const notasActuales: string | null = (causa as any).notas ?? null
  const hoy = new Date().toISOString().split('T')[0]

  const nuevasNotas = quiereTerminar
    ? marcarTerminada(notasActuales, hoy)
    : desmarcarTerminada(notasActuales)

  // null = no había nada que cambiar (ya estaba en el estado pedido). Idempotente.
  if (nuevasNotas === null) {
    return NextResponse.json({
      rit: (causa as any).rit,
      terminada: quiereTerminar,
      sin_cambios: true,
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const { error: errEscribir } = await sb
    .from('causas')
    // Si al quitar la marca no queda texto, se guarda null en vez de un string vacío.
    .update({ notas: nuevasNotas || null, updated_at: new Date().toISOString() })
    .eq('id', causaId)
  if (errEscribir) {
    return NextResponse.json({ error: `No se pudo guardar: ${errEscribir.message}` }, { status: 500 })
  }

  return NextResponse.json({
    rit: (causa as any).rit,
    terminada: estaTerminada(nuevasNotas),
    sin_cambios: false,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
