// CAUSASPRO - API: análisis estratégico IA de una causa
// ------------------------------------------------------------
// GET /api/analisis/<causaId> → { resumen, proximoPaso, riesgo, desdeIA }
//
// Lee la causa + movimientos/audiencias de Supabase (server-side), arma un
// contexto SIN PII innecesaria (no manda RUT ni nombres completos de NNA al
// modelo) y pide a la IA un análisis. Solo analiza causas con datos del bot.
//
// La IA SUGIERE, no decide: la UI muestra el disclaimer profesional.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { analizarCausaIA, iaDisponible } from '@/lib/aiClient'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Rate-limiting simple en memoria: este endpoint GASTA dinero (llama a un tercero) en
// cada request, así que limitamos cuántas llamadas puede hacer una IP por ventana, para
// que alguien con el token público no itere por ids quemando cuota/costos. En memoria por
// instancia (suficiente a esta escala); si se escala a serverless multi-región, mover a
// un store compartido (KV/Redis).
const RATE_LIMIT = 20            // máx llamadas
const RATE_VENTANA_MS = 60_000   // por minuto
const _hits = new Map<string, number[]>()
function excedeRateLimit(ip: string): boolean {
  const ahora = Date.now()
  const previos = (_hits.get(ip) || []).filter(t => ahora - t < RATE_VENTANA_MS)
  if (previos.length >= RATE_LIMIT) { _hits.set(ip, previos); return true }
  previos.push(ahora)
  _hits.set(ip, previos)
  return false
}

/**
 * Autorización: mismo patrón que /api/reporte/[id]. El análisis se arma con
 * datos de una causa de menores, así que NO puede quedar abierto (IDOR).
 * Token público del frontend (NEXT_PUBLIC_REPORTE_TOKEN) o token de servicio.
 * Fail-closed si no hay ningún token configurado.
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

function fmtFecha(iso: string | null): string {
  if (!iso) return 's/f'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? 's/f' : d.toLocaleDateString('es-CL')
}

/**
 * Red de seguridad anti-PII: aunque solo mandamos campos de trámite (etiquetas de tipo
 * de trámite, no el cuerpo de la resolución), estos pueden ocasionalmente traer un RUT o
 * un nombre embebido. Redactamos RUT chilenos y secuencias de nombres propios antes de
 * armar el prompt que sale a un tercero. Es defensa en profundidad, no la protección
 * principal (la principal es NO traer `descripcion` ni `caratulado`).
 */
function redactarPII(texto: string): string {
  if (!texto) return ''
  return texto
    // RUT chileno: 12.345.678-9 / 12345678-9 / 1234567-K
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[RUT]')
    // Secuencias de 2+ palabras Capitalizadas (posibles nombres propios), incluyendo tildes.
    .replace(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)(\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3}\b/g, '[NOMBRE]')
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  // Rate-limit por IP (endpoint que gasta dinero en cada llamada).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida'
  if (excedeRateLimit(ip)) {
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.' }, { status: 429 })
  }
  if (!iaDisponible()) {
    // Fail-safe honesto: sin key, no fingimos un análisis.
    return NextResponse.json(
      { error: 'IA no configurada (falta OPENROUTER_KEY en el servidor).' },
      { status: 503 },
    )
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

  const [cRes, movRes, audRes, nnaRes] = await Promise.all([
    // Solo campos procesales. NO traemos caratulado ni sintesis: el caratulado suele
    // contener el NOMBRE del NNA y no debe salir a un tercero.
    sb.from('causas').select('rit, tipo, estado, programa_vigente, fecha_apertura').eq('id', causaId).single(),
    // De los movimientos NO traemos `descripcion` (texto libre de la resolución, que en
    // causas de protección suele traer nombres/RUT de NNA y progenitores embebidos).
    // Solo etapa/tramite (tipo de trámite) + fecha + flag de traslado.
    sb.from('movimientos').select('fecha, etapa, tramite, es_traslado_curador').eq('causa_id', causaId).order('fecha', { ascending: false }).limit(40),
    sb.from('audiencias').select('fecha, tipo').eq('causa_id', causaId).order('fecha', { ascending: false }).limit(10),
    sb.from('nna').select('edad').eq('causa_id', causaId),
  ])

  if (cRes.error || !cRes.data) {
    return NextResponse.json({ error: 'Causa no encontrada' }, { status: 404 })
  }

  const c: any = cRes.data
  const movimientos = movRes.data || []
  const audiencias = audRes.data || []
  const nna = nnaRes.data || []

  // Solo analizamos causas CON datos reales del bot. Sin movimientos ni audiencias,
  // la IA no tendría sobre qué opinar (evita inventar).
  if (movimientos.length === 0 && audiencias.length === 0) {
    return NextResponse.json(
      { error: 'Esta causa aún no tiene datos del portal. Córrela con el bot antes de analizarla.' },
      { status: 422 },
    )
  }

  // Construir contexto SIN PII innecesaria: NO se manda RUT ni nombres de NNA al modelo.
  // Solo datos procesales + cantidad/edades de NNA (agregado, no identificable).
  const lineas: string[] = []
  lineas.push(`RIT: ${c.rit}`)
  if (c.tipo) lineas.push(`Tipo/materia (letra): ${c.tipo}`)
  if (c.estado) lineas.push(`Estado actual: ${c.estado}`)
  if (c.programa_vigente) lineas.push(`Programa vigente: ${c.programa_vigente}`)
  if (c.fecha_apertura) lineas.push(`Fecha de apertura: ${fmtFecha(c.fecha_apertura)}`)
  if (nna.length > 0) {
    const edades = nna.map((n: any) => n.edad).filter((e: any) => e != null)
    lineas.push(`NNA involucrados: ${nna.length}${edades.length ? ` (edades: ${edades.join(', ')})` : ''}`)
  }
  if (audiencias.length > 0) {
    lineas.push(`\nAudiencias (más recientes):`)
    for (const a of audiencias) lineas.push(`- ${fmtFecha(a.fecha)}: ${a.tipo || 'Audiencia'}`)
  }
  if (movimientos.length > 0) {
    lineas.push(`\nÚltimos movimientos (más reciente primero):`)
    for (const m of movimientos.slice(0, 25)) {
      const tras = m.es_traslado_curador ? ' [TRASLADO AL CURADOR]' : ''
      // Solo tipo de trámite + etapa (etiquetas), redactados por si traen PII embebida.
      const tramite = redactarPII(m.tramite || '')
      const etapa = m.etapa ? ` (${redactarPII(m.etapa)})` : ''
      lineas.push(`- ${fmtFecha(m.fecha)} · ${tramite}${etapa}${tras}`)
    }
  }

  try {
    const analisis = await analizarCausaIA(lineas.join('\n'))
    return NextResponse.json(analisis, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'La IA no pudo analizar la causa en este momento. Intenta de nuevo.' },
      { status: 502 },
    )
  }
}
