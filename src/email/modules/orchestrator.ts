// ============================================================
// CAUSASPRO EMAIL - Orchestrator
// Controla el flujo completo: conectar → buscar → parsear → sync
// ============================================================

import type { EmailRunStatus } from '../types'
import { getImapConfig, fetchAsignacionEmailsSimple } from './imapClient'
import { parseAsignacionesFromHtml } from './htmlParser'
import { syncAsignaciones } from './syncAsignaciones'

/**
 * Ejecuta una revisión completa de emails de ASIGNACIONES
 */
export async function runEmailCheck(): Promise<EmailRunStatus> {
  const runId = `email_${Date.now().toString(36)}`
  
  const status: EmailRunStatus = {
    run_id: runId,
    started_at: new Date().toISOString(),
    emails_revisados: 0,
    emails_procesados: 0,
    asignaciones_total: 0,
    causas_creadas: 0,
    errores: [],
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📧 CausasPro Email Interceptor')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  
  try {
    // 1. Obtener config IMAP
    const config = getImapConfig()
    console.log(`📬 Servidor: ${config.host}`)
    console.log(`👤 Usuario: ${config.user}`)
    
    // 2. Buscar emails de ASIGNACIONES
    console.log('\n🔍 Buscando emails de ASIGNACIONES...')
    const emails = await fetchAsignacionEmailsSimple(config)
    status.emails_revisados = emails.length
    
    if (emails.length === 0) {
      console.log('ℹ️ No hay emails nuevos de ASIGNACIONES')
      status.finished_at = new Date().toISOString()
      return status
    }
    
    console.log(`\n📩 ${emails.length} email(s) encontrado(s)`)
    
    // 3. Procesar cada email
    for (const email of emails) {
      console.log(`\n--- Procesando: "${email.subject}" (${email.date}) ---`)
      
      try {
        // Parsear tabla HTML
        const asignaciones = parseAsignacionesFromHtml(email.html)
        
        if (asignaciones.length === 0) {
          console.log('  ⚠️ No se encontraron asignaciones en este email')
          continue
        }
        
        status.asignaciones_total += asignaciones.length
        
        // Sync con Supabase
        const result = await syncAsignaciones(asignaciones, {
          email_id: email.id,
          fecha: email.date,
          remitente: email.from,
        })
        
        status.emails_procesados++
        status.causas_creadas += result.causas_nuevas
        
        if (result.errores.length > 0) {
          status.errores.push(...result.errores)
        }
        
        console.log(`  📊 Resultado: ${result.causas_nuevas} nuevas, ${result.causas_existentes} existentes, ${result.audiencias_creadas} audiencias`)
        
      } catch (error: any) {
        console.error(`  ❌ Error procesando email: ${error.message}`)
        status.errores.push(`Email ${email.id}: ${error.message}`)
      }
    }
    
  } catch (error: any) {
    console.error(`\n❌ Error fatal: ${error.message}`)
    status.errores.push(error.message)
  }
  
  status.finished_at = new Date().toISOString()
  
  // Resumen
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📊 Resumen:')
  console.log(`   Emails revisados: ${status.emails_revisados}`)
  console.log(`   Emails procesados: ${status.emails_procesados}`)
  console.log(`   Asignaciones: ${status.asignaciones_total}`)
  console.log(`   Causas nuevas: ${status.causas_creadas}`)
  if (status.errores.length > 0) {
    console.log(`   ⚠️ Errores: ${status.errores.length}`)
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  return status
}
