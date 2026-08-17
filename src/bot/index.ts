// ============================================================
// CAUSASPRO BOT - Main Entry Point
// Uso: npx tsx src/bot/index.ts
// ============================================================

export { runBotSession, runUrgentOnly, runTestSingle } from './modules/orchestrator'
export { analyzeCausaUrgency, generateAlertSummary } from './modules/detection'
export { initSupabase, getCausasToScrape } from './modules/supabaseSync'
export { getPJUDCredentials, getIMAPCredentials } from './modules/credentials'
export type { BotConfig, CausaScrapedData, BotRunStatus, ScrapeSessionResult } from './types'

// CLI runner
async function main() {
  const { runBotSession } = await import('./modules/orchestrator')
  const { getPJUDCredentials } = await import('./modules/credentials')
  
  console.log('🚀 Iniciando CausasPro Bot...')
  console.log(`   Hora Chile: ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`)
  console.log('')
  
  // Obtener credenciales (env vars → Supabase DB)
  const credentials = await getPJUDCredentials()
  
  if (!credentials) {
    console.error('❌ Error: No se encontraron credenciales PJUD')
    console.error('')
    console.error('Opciones:')
    console.error('  1. Variables de entorno: PJUD_RUT="12345678-9" PJUD_PASSWORD="pass"')
    console.error('  2. Configurar en la app: /config')
    console.error('')
    process.exit(1)
  }
  
  console.log(`   RUT: ${credentials.rut.slice(0, 4)}****`)
  console.log('')
  
  const result = await runBotSession(credentials)
  
  // Output result
  console.log('\n📋 Resultado:')
  console.log(JSON.stringify(result.status, null, 2))
  
  if (result.data.length > 0) {
    const urgentes = result.data.filter(d => d.tiene_traslado_curador)
    if (urgentes.length > 0) {
      console.log('\n🔴 CAUSAS CON TRASLADO AL CURADOR:')
      urgentes.forEach(u => console.log(`   - ${u.rit}`))
    }
  }
  
  process.exit(result.status.detenido_por === 'completado' ? 0 : 1)
}

// Solo ejecutar si es el archivo principal
if (require.main === module) {
  main().catch(err => {
    console.error('❌ Error fatal:', err.message)
    process.exit(1)
  })
}
