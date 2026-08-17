import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/email - Verifica configuración del interceptor
 */
export async function GET() {
  const hasImap = !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD)
  const hasAlt = !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD)
  const hasSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  
  return NextResponse.json({
    interceptor: 'CausasPro Email Interceptor',
    version: '1.0.0',
    configuracion: {
      imap: (hasImap || hasAlt) ? '✅ Configurado' : '❌ Falta IMAP_HOST, IMAP_USER, IMAP_PASSWORD',
      supabase: hasSupabase ? '✅ Configurado' : '❌ Falta configuración',
    },
    que_hace: [
      'Conecta a tu correo por IMAP',
      'Busca emails de curaduriasnnarnorte@cajmetro.cl con asunto "ASIGNACIONES"',
      'Parsea la tabla HTML (RIT, FECHA AUD, FECHA ING, CURADOR)',
      'Crea las causas nuevas en Supabase',
      'Crea audiencias con las fechas del email',
      'Marca los emails como leídos',
    ],
    instrucciones: {
      local: 'IMAP_HOST="mail.cajmetro.cl" IMAP_USER="pvargas@cajmetro.cl" IMAP_PASSWORD="pass" npx tsx src/email/index.ts',
      variables_requeridas: [
        'IMAP_HOST - Servidor IMAP (ej: mail.cajmetro.cl o imap.cajmetro.cl)',
        'IMAP_USER - Tu email completo (pvargas@cajmetro.cl)',
        'IMAP_PASSWORD - Contraseña del correo',
        'NEXT_PUBLIC_SUPABASE_URL - URL Supabase',
        'SUPABASE_SERVICE_ROLE_KEY - Service role key',
      ],
      nota_servidor_imap: [
        'Si no sabes el servidor IMAP, prueba con:',
        '  mail.cajmetro.cl',
        '  imap.cajmetro.cl',
        '  correo.cajmetro.cl',
        'O pregunta al departamento de TI de cajmetro',
      ],
    },
  })
}
