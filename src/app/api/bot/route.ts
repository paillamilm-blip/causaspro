import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * API endpoint para controlar el bot PJUD
 * 
 * POST /api/bot - Inicia una sesión del bot
 * GET /api/bot - Obtiene estado del último run
 * 
 * NOTA: El bot NO se ejecuta dentro de Vercel (timeout de 10s).
 * Este endpoint es para:
 * 1. Verificar configuración
 * 2. Disparar el bot en un servidor externo (futuro)
 * 3. Ver status de ejecuciones
 * 
 * Para ejecutar el bot realmente, usar:
 * - Localmente: npx tsx src/bot/index.ts
 * - Servidor: cron job en VPS/Railway/Render
 */
export async function GET() {
  const hasCredentials = !!(process.env.PJUD_RUT && process.env.PJUD_PASSWORD)
  const hasSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  
  return NextResponse.json({
    bot: 'CausasPro PJUD Bot',
    version: '1.0.0',
    configuracion: {
      credenciales_pjud: hasCredentials ? '✅ Configuradas' : '❌ Falta PJUD_RUT y PJUD_PASSWORD',
      supabase: hasSupabase ? '✅ Configurado' : '❌ Falta configuración',
    },
    instrucciones: {
      local: 'PJUD_RUT="12345678-9" PJUD_PASSWORD="pass" npx tsx src/bot/index.ts',
      variables_requeridas: [
        'PJUD_RUT - RUT del usuario en OJV (formato: 12345678-9)',
        'PJUD_PASSWORD - Contraseña del portal PJUD',
        'NEXT_PUBLIC_SUPABASE_URL - URL del proyecto Supabase',
        'SUPABASE_SERVICE_ROLE_KEY - Service role key de Supabase',
      ],
      notas: [
        'El bot NO se puede ejecutar en Vercel (timeout limitado)',
        'Ejecutar localmente o en un VPS/Railway con cron',
        'Anti-detección: máximo 25 causas por sesión, delays 30-90s',
        'Solo opera entre 8:00-18:00 hora Chile',
      ],
    },
  })
}

export async function POST(req: NextRequest) {
  // Verificar auth básica (solo admin puede disparar el bot)
  const authHeader = req.headers.get('authorization')
  const expectedToken = process.env.BOT_API_TOKEN || process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!authHeader || !authHeader.includes(expectedToken?.slice(0, 20) || 'NO_TOKEN')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  
  const hasCredentials = !!(process.env.PJUD_RUT && process.env.PJUD_PASSWORD)
  
  if (!hasCredentials) {
    return NextResponse.json({
      error: 'Credenciales PJUD no configuradas',
      solucion: 'Agregar PJUD_RUT y PJUD_PASSWORD en variables de entorno',
    }, { status: 400 })
  }
  
  // En Vercel, no podemos ejecutar Playwright (serverless = timeout corto)
  // Retornamos instrucciones para ejecución externa
  return NextResponse.json({
    message: 'Bot no se puede ejecutar en Vercel (serverless limitado)',
    alternativas: [
      '1. Ejecutar localmente: npx tsx src/bot/index.ts',
      '2. Deploy en Railway/Render como worker',
      '3. GitHub Actions con cron schedule',
      '4. VPS con crontab',
    ],
    comando: `cd causaspro && PJUD_RUT="${process.env.PJUD_RUT}" PJUD_PASSWORD="***" npx tsx src/bot/index.ts`,
  })
}
