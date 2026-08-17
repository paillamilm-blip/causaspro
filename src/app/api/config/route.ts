import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Clave para encriptar (en producción usar variable de entorno dedicada)
const ENCRYPT_KEY = process.env.CONFIG_ENCRYPT_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 32) || 'causaspro_default_key_2024'

/**
 * GET /api/config - Obtiene todas las configuraciones (sin mostrar passwords)
 */
export async function GET() {
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
    
    return NextResponse.json({ configs })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * POST /api/config - Guarda configuraciones
 * Body: { configs: { clave: valor, clave2: valor2, ... } }
 */
export async function POST(req: NextRequest) {
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
      
      // Upsert
      const { error } = await supabase
        .from('configuracion')
        .update({ valor: valorFinal, updated_at: new Date().toISOString() })
        .eq('clave', clave)
      
      if (error) {
        // Si no existe, insertar
        await supabase.from('configuracion').insert({
          clave,
          valor: valorFinal,
          encriptado: clave.includes('password'),
        })
      }
      
      results[clave] = '✅'
    }
    
    return NextResponse.json({ ok: true, guardados: results })
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
