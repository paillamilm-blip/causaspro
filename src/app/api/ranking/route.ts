import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// Endpoint server-side del ranking de causas (semáforo).
//
// Por qué existe: el dashboard consulta v_causas_ranking directo desde el navegador
// con el rol `anon`, que tiene un statement_timeout bajo (~8s). Esa vista es cara
// (~20 subqueries correlacionados por fila) y a veces supera el timeout → el panel
// caía al fallback "todo Estable". Este route corre con service_role (sin ese
// timeout), así que sirve como red de seguridad: si la consulta anon del cliente
// falla, el Dashboard pide aquí y obtiene el semáforo real igual.
//
// SEGURIDAD: la vista incluye nombres de NNA (menores). Mismo patrón fail-closed
// que /api/reporte/[id]: se exige un token. El frontend manda NEXT_PUBLIC_REPORTE_TOKEN
// por ?token=. Si NO hay ningún token configurado en el entorno, se BLOQUEA por defecto
// (fail-closed) para no exponer PII por una mala configuración.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function estaAutorizado(req: NextRequest): boolean {
  const header = req.headers.get('authorization') || ''
  const url = new URL(req.url)
  const qToken = url.searchParams.get('token') || ''

  // Token público (va en el link/fetch del frontend). No da acceso directo a la BD.
  const tokenPublico = process.env.NEXT_PUBLIC_REPORTE_TOKEN
  if (tokenPublico && qToken && qToken === tokenPublico) return true

  // Token de servicio (integraciones/servidor).
  const esperado = process.env.REPORTE_API_TOKEN
    || process.env.BOT_API_TOKEN
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!esperado) return false // fail-closed: sin token configurado, no servimos PII
  const min = esperado.slice(0, 20)
  return header.includes(min) || qToken === esperado || qToken.slice(0, 20) === min
}

export async function GET(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()

    // Traer TODAS las filas paginando de a 1000 (límite de PostgREST por request).
    // .order('id') da orden total estable entre páginas (evita saltar/duplicar filas
    // de borde con >1000 filas). La vista ya ordena por id internamente; esto lo hace
    // explícito para PostgREST.
    const PAGE = 1000
    let desde = 0
    let todo: any[] = []
    for (;;) {
      const { data, error } = await admin
        .from('v_causas_ranking')
        .select('*')
        .order('id', { ascending: true })
        .range(desde, desde + PAGE - 1)
      if (error) {
        return NextResponse.json(
          { error: error.message, code: (error as any).code ?? null },
          { status: 500 },
        )
      }
      const lote = data || []
      todo = todo.concat(lote)
      if (lote.length < PAGE) break
      desde += PAGE
    }

    return NextResponse.json({ causas: todo }, { status: 200 })
  } catch (e: any) {
    // Típicamente: falta SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor.
    return NextResponse.json(
      { error: e?.message || 'Error interno del servidor' },
      { status: 500 },
    )
  }
}
