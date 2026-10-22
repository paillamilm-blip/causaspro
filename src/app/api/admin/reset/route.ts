import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { estaAutorizado, excedeRateLimit } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * DELETE /api/admin/reset - Borra TODAS las causas y datos relacionados
 * ⚠️ CUIDADO: Esto es irreversible
 *
 * ⚠️ AHORA PIDE TOKEN: este endpoint borraba la base ENTERA sin ninguna
 * autenticación, y la app está desplegada en una URL pública de Vercel. Basta
 * que un robot o cualquier persona que vea la dirección mande un DELETE para
 * perder todos los expedientes, movimientos y audiencias. Se cerró con el mismo
 * token fail-closed que usan /api/reporte y /api/asignaciones.
 */
export async function DELETE(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  if (excedeRateLimit(req, 'admin-reset', 2, 60_000)) {
    return NextResponse.json({ error: 'Demasiados intentos. Esperá un minuto.' }, { status: 429 })
  }
  try {
    const supabase = createAdminClient()

    // Borrar en orden por foreign keys
    await supabase.from('bot_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('movimientos').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('audiencias').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('nna').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('adultos').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('programas').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('medidas_cautelares').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('causas').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    return NextResponse.json({ ok: true, message: '🗑️ Todos los datos han sido borrados' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * GET /api/admin/reset - Muestra conteo de datos actual
 */
export async function GET(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const supabase = createAdminClient()

    const [causas, nna, adultos, audiencias] = await Promise.all([
      supabase.from('causas').select('id', { count: 'exact', head: true }),
      supabase.from('nna').select('id', { count: 'exact', head: true }),
      supabase.from('adultos').select('id', { count: 'exact', head: true }),
      supabase.from('audiencias').select('id', { count: 'exact', head: true }),
    ])

    return NextResponse.json({
      datos_actuales: {
        causas: causas.count || 0,
        nna: nna.count || 0,
        adultos: adultos.count || 0,
        audiencias: audiencias.count || 0,
      },
      instrucciones: 'Para borrar todo, envía DELETE a este endpoint'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
