// ============================================================
// CAUSASPRO - API: cargar asignaciones pegando el correo de la jefa
// ------------------------------------------------------------
// POST /api/asignaciones
//   body: { contenido, contenidoTexto?, confirmar? }
//
// Reemplaza al interceptor IMAP, que NO puede funcionar: el correo de la
// curadora está en Microsoft 365 y Microsoft eliminó la autenticación básica
// (usuario+contraseña) para IMAP/POP en Exchange Online, que es justo lo que
// usaba src/email/modules/imapClient.ts. La vía automática sería Microsoft
// Graph con OAuth, que requiere que TI de cajmetro registre una aplicación.
//
// Mientras eso no exista, la curadora copia el correo y lo pega acá. Se
// reutiliza TAL CUAL la lógica ya construida y probada del interceptor:
// el parser de la tabla (parseAsignaciones) y el sync a Supabase
// (syncAsignaciones). Lo único que cambia es de dónde llega el texto.
//
// Flujo de DOS PASOS a propósito: primero `confirmar: false` devuelve una
// vista previa que NO escribe nada (así la curadora ve qué se detectó y qué
// causas son nuevas antes de tocar la base), y solo con `confirmar: true` se
// guarda. Evita que un pegado mal copiado cree causas basura.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { parseAsignaciones } from '@/email/modules/htmlParser'
import { syncAsignaciones } from '@/email/modules/syncAsignaciones'
import type { AsignacionEmail } from '@/email/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Tope del pegado. Un correo de asignaciones con formato de Outlook pesa unos pocos
 *  cientos de KB; 2 MB deja margen de sobra y evita que alguien mande basura enorme. */
const MAX_CARACTERES = 2_000_000

/** Tope de asignaciones por pegado: red de seguridad ante un pegado accidental
 *  (ej. el buzón completo). Los correos reales traen unas pocas decenas de filas. */
const MAX_ASIGNACIONES = 300

// Rate-limit simple en memoria: este endpoint ESCRIBE en la base, así que limitamos
// cuántas veces por minuto se puede llamar desde una misma IP.
const RATE_LIMIT = 15
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

/**
 * Autorización: mismo patrón que /api/analisis y /api/reporte. Acá se crean causas de
 * menores, así que no puede quedar abierto. Fail-closed si no hay ningún token configurado.
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

/** Asignación + si el RIT ya está en la base (para la vista previa). */
interface AsignacionPrevia extends AsignacionEmail {
  yaExiste: boolean
}

export async function POST(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida'
  if (excedeRateLimit(ip)) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento.' }, { status: 429 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo de la solicitud inválido.' }, { status: 400 })
  }

  const contenido: string = typeof body?.contenido === 'string' ? body.contenido : ''
  const contenidoTexto: string = typeof body?.contenidoTexto === 'string' ? body.contenidoTexto : ''
  const confirmar: boolean = body?.confirmar === true

  if (!contenido.trim() && !contenidoTexto.trim()) {
    return NextResponse.json({ error: 'No pegaste nada. Copiá el correo completo y pegalo en el cuadro.' }, { status: 400 })
  }
  if (contenido.length > MAX_CARACTERES || contenidoTexto.length > MAX_CARACTERES) {
    return NextResponse.json({ error: 'El contenido pegado es demasiado grande. Pegá un solo correo.' }, { status: 413 })
  }

  // La pantalla manda DOS versiones del portapapeles: el HTML (que conserva la tabla) y el
  // texto plano. Se parsean las dos y se usa la que detecte más asignaciones, porque según
  // desde dónde se copie (Outlook escritorio, web, Android) una u otra puede venir vacía.
  const porHtml = parseAsignaciones(contenido)
  const porTexto = contenidoTexto ? parseAsignaciones(contenidoTexto) : { asignaciones: [], origen: 'vacio' as const }
  const mejor = porTexto.asignaciones.length > porHtml.asignaciones.length ? porTexto : porHtml

  if (mejor.asignaciones.length === 0) {
    return NextResponse.json({
      error: 'No encontré ninguna asignación en lo que pegaste.',
      pista: 'Revisá que hayas copiado la TABLA del correo (la que tiene RIT, FECHA AUD, FECHA ING y CURADOR). Tip: en el correo hacé Ctrl+A y después Ctrl+C para copiar todo.',
      asignaciones: [],
      origen: 'vacio',
    }, { status: 422 })
  }

  if (mejor.asignaciones.length > MAX_ASIGNACIONES) {
    return NextResponse.json({
      error: `Detecté ${mejor.asignaciones.length} asignaciones, más de las ${MAX_ASIGNACIONES} permitidas por vez. Pegá un correo a la vez.`,
    }, { status: 413 })
  }

  let sb
  try {
    sb = createAdminClient()
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Supabase no configurado' }, { status: 500 })
  }

  // ¿Cuáles de estos RIT ya existen? Una sola consulta con `in` en vez de una por fila.
  const rits = mejor.asignaciones.map((a) => a.rit)
  const { data: existentes, error: errExist } = await sb
    .from('causas')
    .select('rit')
    .in('rit', rits)
  if (errExist) {
    return NextResponse.json({ error: `Error consultando las causas: ${errExist.message}` }, { status: 500 })
  }
  const setExistentes = new Set((existentes || []).map((c: any) => c.rit))

  const previa: AsignacionPrevia[] = mejor.asignaciones.map((a) => ({
    ...a,
    yaExiste: setExistentes.has(a.rit),
  }))
  const nuevas = previa.filter((a) => !a.yaExiste).length

  // ---- PASO 1: vista previa. No escribe NADA. ----
  if (!confirmar) {
    return NextResponse.json({
      modo: 'previa',
      origen: mejor.origen,
      asignaciones: previa,
      total: previa.length,
      nuevas,
      existentes: previa.length - nuevas,
      sin_fecha_audiencia: previa.filter((a) => !a.fecha_audiencia).length,
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // ---- PASO 2: guardar de verdad, reutilizando el sync del interceptor. ----
  try {
    const resultado = await syncAsignaciones(mejor.asignaciones, {
      // Identificador del "email": no viene de IMAP, así que se marca como pegado a mano.
      // Sirve para rastrear el origen en la tabla email_logs.
      email_id: `pegado_${Date.now().toString(36)}`,
      fecha: new Date().toISOString().split('T')[0],
      remitente: 'pegado manualmente en CausasPro',
    })
    return NextResponse.json({
      modo: 'guardado',
      origen: mejor.origen,
      total: mejor.asignaciones.length,
      causas_nuevas: resultado.causas_nuevas,
      causas_existentes: resultado.causas_existentes,
      audiencias_creadas: resultado.audiencias_creadas,
      errores: resultado.errores,
      asignaciones: previa,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    console.error('[asignaciones] error guardando:', e?.message || e)
    return NextResponse.json({ error: `No se pudieron guardar las asignaciones: ${e?.message || 'error desconocido'}` }, { status: 500 })
  }
}
