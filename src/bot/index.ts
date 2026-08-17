// ============================================================
// CAUSASPRO BOT - Main Entry Point
// Uso: npx tsx src/bot/index.ts
// ============================================================

export { runBotSession, runUrgentOnly, runTestSingle } from './modules/orchestrator'
export { analyzeCausaUrgency, generateAlertSummary } from './modules/detection'
export { initSupabase, getCausasToScrape } from './modules/supabaseSync'
export type { BotConfig, CausaScrapedData, BotRunStatus, ScrapeSessionResult } from './types'

// CLI runner
async function main() {
  const { runBotSession } = await import('./modules/orchestrator')
  
  // Credenciales desde variables de entorno
  const rut = process.env.PJUD_RUT
  const password = process.env.PJUD_PASSWORD
  
  if (!rut || !password) {
    console.error('❌ Error: Variables de entorno PJUD_RUT y PJUD_PASSWORD requeridas')
    console.error('')
    console.error('Uso:')
    console.error('  PJUD_RUT="12345678-9" PJUD_PASSWORD="mipass" npx tsx src/bot/index.ts')
    console.error('')
    console.error('O configura en .env.local:')
    console.error('  PJUD_RUT=12345678-9')
    console.error('  PJUD_PASSWORD=mipass')
    process.exit(1)
  }
  
  console.log('🚀 Iniciando CausasPro Bot...')
  console.log(`   RUT: ${rut.slice(0, 4)}****`)
  console.log(`   Hora Chile: ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`)
  console.log('')
  
  const result = await runBotSession({ rut, password })
  
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
