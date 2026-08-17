import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Cliente público (para el frontend)
// Se crea de forma lazy para evitar crash si las variables no están configuradas
let _supabaseClient: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!_supabaseClient) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Supabase no configurado. Agrega NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en las variables de entorno.'
      )
    }
    _supabaseClient = createClient(supabaseUrl, supabaseAnonKey)
  }
  return _supabaseClient
}

// Compatibilidad: export directo (se crea solo si hay variables)
export const supabase: SupabaseClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : new Proxy({} as SupabaseClient, {
      get(_, prop) {
        if (prop === 'from' || prop === 'rpc') {
          return () => ({
            select: () => ({ data: null, error: { message: 'Supabase no configurado' }, count: 0 }),
            insert: () => ({ data: null, error: { message: 'Supabase no configurado' } }),
            update: () => ({ data: null, error: { message: 'Supabase no configurado' } }),
            eq: () => ({ data: null, error: { message: 'Supabase no configurado' } }),
            single: () => ({ data: null, error: { message: 'Supabase no configurado' } }),
            limit: () => ({ data: null, error: { message: 'Supabase no configurado' } }),
            order: () => ({ data: null, error: { message: 'Supabase no configurado' } }),
          })
        }
        return undefined
      }
    })

// Cliente admin (solo para API routes - server side)
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!url || !key) {
    throw new Error(
      'Variables de entorno del servidor no configuradas: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY'
    )
  }
  
  return createClient(url, key)
}
