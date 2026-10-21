import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { estaAutorizado, excedeRateLimit } from '@/lib/apiAuth'

// ============================================================
// COBERTURA DEL BOT (red de seguridad del panel)
// ------------------------------------------------------------
// El panel primero lee v_cobertura / v_run_activo / v_cola_escaneo DIRECTO desde el
// navegador con el rol anon (es barato: son conteos). Este route existe para cuando esa
// lectura directa falla —timeout del rol anon, permisos sin otorgar, o vista aún no
// creada—: corre con service_role y devuelve lo mismo.
//
// Devuelve SOLO conteos y estado de corrida (más la cabeza de la cola con su RIT), no
// movimientos ni nombres de NNA. Aun así va con token: es metadatos de causas de
// menores en un despliegue con URL pública, y el patrón del proyecto es fail-closed.
// ============================================================
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  // Polling del panel: se permite más tráfico que una ruta normal pero acotado.
  if (excedeRateLimit(req, 'cobertura', 60, 60_000)) {
    return NextResponse.json({ error: 'Demasiadas consultas, esperá un momento' }, { status: 429 })
  }

  try {
    const admin = createAdminClient()
    const [cob, runs, cola, conc, faltan] = await Promise.all([
      admin.from('v_cobertura').select('*').limit(1),
      admin.from('v_run_activo').select('*').limit(20),
      admin.from('v_cola_escaneo').select('id, rit, caratulado, escaneo_estado, ultima_escaneada, pendientes_desde, antiguedad_escaneo').limit(10),
      admin.from('v_conciliacion').select('*').limit(1),
      admin.from('v_conciliacion_detalle').select('rit, caratulado').eq('situacion', 'falta_en_bd').limit(300),
    ])

    // v_cobertura/v_run_activo no existen hasta aplicar schema-001-cobertura.sql.
    // 42P01 (tabla/vista inexistente) y 42703 (columna inexistente) se responden como
    // dato, no como error 500: el panel tiene que poder decir "faltá la migración".
    const faltaMigracion = [cob.error, runs.error].some(
      (e) => e && ((e as any).code === '42P01' || (e as any).code === '42703'),
    )
    if (faltaMigracion) {
      return NextResponse.json(
        {
          ok: false,
          motivo: 'migracion_pendiente',
          error: (cob.error || runs.error)?.message,
        },
        { status: 200 },
      )
    }
    if (cob.error) {
      return NextResponse.json({ ok: false, error: cob.error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      cobertura: cob.data?.[0] ?? null,
      runs: runs.data ?? [],
      cola: cola.error ? [] : cola.data ?? [],
      cola_error: cola.error?.message ?? null,
      // La conciliación es un plus: si sus vistas aún no existen (42P01/42703) el panel tiene
      // que poder decir "falta la migración" en vez de "nunca se corrió un inventario".
      conciliacion: conc.error ? null : conc.data?.[0] ?? null,
      conc_error: conc.error?.code ?? null,
      faltan: faltan.error ? [] : faltan.data ?? [],
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Error interno' }, { status: 500 })
  }
}
