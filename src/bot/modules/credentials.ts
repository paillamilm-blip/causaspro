// ============================================================
// CAUSASPRO BOT - Credentials Module
// Lee credenciales desde Supabase o variables de entorno
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { log } from '../utils'

interface Credentials {
  rut: string
  password: string
}

/**
 * Obtiene credenciales PJUD.
 * Prioridad: 
 * 1. Variables de entorno (PJUD_RUT, PJUD_PASSWORD)
 * 2. Base de datos (tabla configuracion)
 */
export async function getPJUDCredentials(): Promise<Credentials | null> {
  // 1. Primero intentar variables de entorno
  if (process.env.PJUD_RUT && process.env.PJUD_PASSWORD) {
    log('info', 'Usando credenciales PJUD desde variables de entorno')
    return {
      rut: process.env.PJUD_RUT,
      password: process.env.PJUD_PASSWORD,
    }
  }
  
  // 2. Si no, leer desde Supabase
  log('info', 'Buscando credenciales PJUD en base de datos...')
  
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!url || !key) {
    log('error', 'No se puede conectar a Supabase para obtener credenciales')
    return null
  }
  
  const supabase = createClient(url, key)
  const encryptKey = process.env.CONFIG_ENCRYPT_KEY || key.slice(0, 32)
  
  try {
    // Obtener RUT
    const { data: rutConfig } = await supabase
      .from('configuracion')
      .select('valor, encriptado')
      .eq('clave', 'pjud_rut')
      .single()
    
    // Obtener Password
    const { data: passConfig } = await supabase
      .from('configuracion')
      .select('valor, encriptado')
      .eq('clave', 'pjud_password')
      .single()
    
    if (!rutConfig?.valor || !passConfig?.valor) {
      log('error', 'Credenciales PJUD no configuradas en la base de datos')
      log('info', 'Configúralas en: /config de la app')
      return null
    }
    
    let rut = rutConfig.valor
    let password = passConfig.valor
    
    // Desencriptar si es necesario
    if (passConfig.encriptado) {
      // Intentar desencriptar con pgcrypto
      const { data: decrypted } = await supabase.rpc('decrypt_config_value', {
        encrypted_text: password,
        secret_key: encryptKey,
      })
      
      if (decrypted) {
        password = decrypted
      } else {
        // Fallback: intentar base64
        try {
          password = Buffer.from(password, 'base64').toString('utf-8')
        } catch {
          log('error', 'No se pudo desencriptar la contraseña')
          return null
        }
      }
    }
    
    log('success', `Credenciales PJUD obtenidas (RUT: ${rut.slice(0, 4)}****)`)
    return { rut, password }
    
  } catch (error: any) {
    log('error', `Error obteniendo credenciales: ${error.message}`)
    return null
  }
}

/**
 * Obtiene credenciales IMAP para el interceptor de correos
 */
export async function getIMAPCredentials(): Promise<{ host: string; user: string; password: string; port: number } | null> {
  // Variables de entorno primero
  if (process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD) {
    return {
      host: process.env.IMAP_HOST,
      user: process.env.IMAP_USER,
      password: process.env.IMAP_PASSWORD,
      port: parseInt(process.env.IMAP_PORT || '993'),
    }
  }
  
  // Leer de Supabase
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!url || !key) return null
  
  const supabase = createClient(url, key)
  const encryptKey = process.env.CONFIG_ENCRYPT_KEY || key.slice(0, 32)
  
  try {
    const { data: configs } = await supabase
      .from('configuracion')
      .select('clave, valor, encriptado')
      .in('clave', ['imap_host', 'imap_user', 'imap_password', 'imap_port'])
    
    if (!configs) return null
    
    const configMap: Record<string, string> = {}
    
    for (const c of configs) {
      if (!c.valor) continue
      
      if (c.encriptado) {
        const { data: decrypted } = await supabase.rpc('decrypt_config_value', {
          encrypted_text: c.valor,
          secret_key: encryptKey,
        })
        configMap[c.clave] = decrypted || Buffer.from(c.valor, 'base64').toString('utf-8')
      } else {
        configMap[c.clave] = c.valor
      }
    }
    
    if (!configMap.imap_host || !configMap.imap_user || !configMap.imap_password) return null
    
    return {
      host: configMap.imap_host,
      user: configMap.imap_user,
      password: configMap.imap_password,
      port: parseInt(configMap.imap_port || '993'),
    }
  } catch {
    return null
  }
}
