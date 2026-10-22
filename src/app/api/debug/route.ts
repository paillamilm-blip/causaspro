import { NextRequest, NextResponse } from 'next/server'
import { estaAutorizado } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// Diagnóstico de variables de entorno. Se cerró con token: decir desde la URL
// pública cuáles credenciales están configuradas es un mapa del tesoro.
export async function GET(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  return NextResponse.json({
    env_check: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ SET' : '❌ MISSING',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ SET' : '❌ MISSING',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ SET' : '❌ MISSING',
      REPORTE_API_TOKEN: process.env.REPORTE_API_TOKEN ? '✅ SET' : '❌ MISSING',
      NEXT_PUBLIC_REPORTE_TOKEN: process.env.NEXT_PUBLIC_REPORTE_TOKEN ? '✅ SET' : '❌ MISSING',
    },
    url_preview: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30) || 'NOT SET',
  })
}
