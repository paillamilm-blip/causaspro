// ============================================================
// CAUSASPRO EMAIL - Sync Asignaciones to Supabase
// Crea nuevas causas y audiencias desde los emails de asignación
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { AsignacionEmail, EmailProcessResult } from '../types'

let supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (supabase) return supabase
  
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!url || !key) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridas')
  }
  
  supabase = createClient(url, key)
  return supabase
}

/**
 * Procesa las asignaciones extraídas de un email:
 * - Si la causa (RIT) ya existe → agrega audiencia
 * - Si la causa NO existe → crea causa + audiencia
 */
export async function syncAsignaciones(
  asignaciones: AsignacionEmail[],
  emailMeta: { email_id: string; fecha: string; remitente: string }
): Promise<EmailProcessResult> {
  const sb = getSupabase()
  
  const result: EmailProcessResult = {
    email_id: emailMeta.email_id,
    fecha_email: emailMeta.fecha,
    remitente: emailMeta.remitente,
    asignaciones,
    causas_nuevas: 0,
    causas_existentes: 0,
    audiencias_creadas: 0,
    errores: [],
  }
  
  for (const asig of asignaciones) {
    try {
      // 1. Verificar si la causa ya existe (por RIT)
      const { data: existing } = await sb
        .from('causas')
        .select('id')
        .eq('rit', asig.rit)
        .limit(1)
      
      let causaId: string
      
      if (existing && existing.length > 0) {
        // Causa ya existe → solo agregar audiencia
        causaId = existing[0].id
        result.causas_existentes++
        console.log(`  📌 ${asig.rit} ya existe → actualizar`)
        
        // Actualizar updated_at para reflejar nueva asignación
        await sb
          .from('causas')
          .update({ 
            updated_at: new Date().toISOString(),
            notas: `Reasignada por email ${emailMeta.fecha}`,
          })
          .eq('id', causaId)
        
      } else {
        // Causa nueva → crear
        const { data: newCausa, error: createErr } = await sb
          .from('causas')
          .insert({
            rit: asig.rit,
            tipo: asig.rit.startsWith('P') ? 'P' : asig.rit.startsWith('X') ? 'X' : null,
            estado: 'Asignada por email',
            fecha_notificacion: asig.fecha_ingreso || new Date().toISOString().split('T')[0],
            notas: `Asignada por ${emailMeta.remitente} el ${emailMeta.fecha}. Curador: ${asig.curador}`,
          })
          .select('id')
          .single()
        
        if (createErr) {
          result.errores.push(`Error creando ${asig.rit}: ${createErr.message}`)
          console.error(`  ❌ Error creando ${asig.rit}: ${createErr.message}`)
          continue
        }
        
        causaId = newCausa.id
        result.causas_nuevas++
        console.log(`  ✅ ${asig.rit} NUEVA causa creada`)
      }
      
      // 2. Crear audiencia si hay fecha
      if (asig.fecha_audiencia) {
        // Verificar que no exista ya una audiencia con esa fecha
        const { data: existingAud } = await sb
          .from('audiencias')
          .select('id')
          .eq('causa_id', causaId)
          .eq('fecha', asig.fecha_audiencia)
          .limit(1)
        
        if (!existingAud || existingAud.length === 0) {
          const { error: audErr } = await sb
            .from('audiencias')
            .insert({
              causa_id: causaId,
              fecha: asig.fecha_audiencia,
              tipo: 'Audiencia (asignada por email)',
              notas: `Curador: ${asig.curador}. Fuente: email ${emailMeta.fecha}`,
            })
          
          if (audErr) {
            result.errores.push(`Error creando audiencia para ${asig.rit}: ${audErr.message}`)
          } else {
            result.audiencias_creadas++
            console.log(`  📅 Audiencia ${asig.fecha_audiencia} creada para ${asig.rit}`)
          }
        } else {
          console.log(`  ℹ️ Audiencia ${asig.fecha_audiencia} ya existía para ${asig.rit}`)
        }
      }
      
    } catch (error: any) {
      result.errores.push(`${asig.rit}: ${error.message}`)
      console.error(`  ❌ Error procesando ${asig.rit}: ${error.message}`)
    }
  }
  
  // 3. Guardar log del procesamiento
  await saveEmailLog(sb, result)
  
  return result
}

/**
 * Guarda log del procesamiento de email
 */
async function saveEmailLog(sb: SupabaseClient, result: EmailProcessResult): Promise<void> {
  try {
    await sb.from('email_logs').insert({
      email_id: result.email_id,
      fecha_email: result.fecha_email,
      remitente: result.remitente,
      asignaciones_total: result.asignaciones.length,
      causas_nuevas: result.causas_nuevas,
      causas_existentes: result.causas_existentes,
      audiencias_creadas: result.audiencias_creadas,
      errores: result.errores.length > 0 ? result.errores : null,
      rits: result.asignaciones.map(a => a.rit),
    })
  } catch {
    // No fallar si la tabla no existe aún
  }
}
