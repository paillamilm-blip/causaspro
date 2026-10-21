import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { estaAutorizado, excedeRateLimit } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// Clave para encriptar (en producción usar variable de entorno dedicada)
const ENCRYPT_KEY = process.env.CONFIG_ENCRYPT_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 32) || 'causaspro_default_key_2024'

// ¿Se está usando la clave DE FÁBRICA (la que está escrita en el código)? Entonces el
// cifrado es decorativo: cualquiera con el repositorio puede descifrar el RUT y la ClaveÚnica
// guardados en `configuracion`. No se rompe el flujo (guardar en claro-embutido es mejor que
// perder la ClaveÚnica), pero se AVISA: es una línea en Vercel y queda resuelto.
const USA_CLAVE_DEFAULT = !process.env.CONFIG_ENCRYPT_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * GET /api/config - Obtiene todas las configuraciones (sin mostrar passwords)
 *
 * CERRADO CON TOKEN: esta tabla guarda el RUT y la ClaveÚnica del bot. Antes
 * cualquiera podía leerlos sin autenticación desde la URL pública de Vercel.
 */
export async function GET(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const supabase = createAdminClient()
    
    const { data, error } = await supabase
      .from('configuracion')
      .select('*')
      .order('clave')
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    // Ocultar valores encriptados (solo mostrar si tiene valor o no)
    const configs = (data || []).map(c => ({
      ...c,
      valor: c.encriptado ? (c.valor ? '••••••••' : null) : c.valor,
      tiene_valor: !!c.valor,
    }))
    
    return NextResponse.json({
      configs,
      advertencia_clave: USA_CLAVE_DEFAULT
        ? 'Se está usando la clave de cifrado de fábrica: los valores guardados (RUT y ClaveÚnica del bot) ' +
          'se pueden descifrar con el código del repositorio. Definí CONFIG_ENCRYPT_KEY en Vercel ' +
          '(Settings → Environment Variables) con un valor largo y distinto, y volvé a guardar las claves.'
        : null,
    })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * POST /api/config - Guarda configuraciones
 * Body: { configs: { clave: valor, clave2: valor2, ... } }
 */
export async function POST(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  if (excedeRateLimit(req, 'config', 10, 60_000)) {
    return NextResponse.json({ error: 'Demasiados guardados seguidos. Esperá un minuto.' }, { status: 429 })
  }
  try {
    const body = await req.json()
    const { configs } = body as { configs: Record<string, string> }
    
    if (!configs || typeof configs !== 'object') {
      return NextResponse.json({ error: 'Body debe tener { configs: { clave: valor } }' }, { status: 400 })
    }
    
    const supabase = createAdminClient()
    const results: Record<string, string> = {}
    
    for (const [clave, valor] of Object.entries(configs)) {
      if (!valor || valor === '••••••••') continue // Skip valores vacíos o masked
      
      // Verificar si esta config es encriptada
      const { data: existing } = await supabase
        .from('configuracion')
        .select('encriptado')
        .eq('clave', clave)
        .single()
      
      let valorFinal = valor
      
      // Encriptar si es necesario
      if (existing?.encriptado && valor) {
        // Usar pgcrypto para encriptar
        const { data: encrypted } = await supabase.rpc('encrypt_config_value', {
          plain_text: valor,
          secret_key: ENCRYPT_KEY,
        })
        
        if (encrypted) {
          // Prefijo para identificar método de encriptación
          valorFinal = `pgp:${encrypted}`
        } else {
          // Fallback: base64 con prefijo
          valorFinal = `b64:${Buffer.from(valor).toString('base64')}`
        }
      }
      
      // Upsert REAL. Antes se hacía `update(...)` y, "si falla", un insert — pero un
      // UPDATE de PostgREST sobre una fila inexistente NO devuelve error: devuelve 0
      // filas afectadas. O sea que una clave nueva nunca se insertaba y aun así
      // respondía '✅'. Como ya leímos `existing` arriba para saber si es encriptada,
      // se decide con ese dato y nada más.
      const payload = { valor: valorFinal, updated_at: new Date().toISOString() }
      const { error } = existing
        ? await supabase.from('configuracion').update(payload).eq('clave', clave)
        : await supabase.from('configuracion').insert({
            clave,
            valor: valorFinal,
            encriptado: clave.includes('password'),
          })

      if (error) {
        results[clave] = `❌ ${error.message}`
        continue
      }
      
      results[clave] = '✅'
    }
    
    return NextResponse.json({ ok: true, guardados: results })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
