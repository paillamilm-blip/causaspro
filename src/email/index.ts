// ============================================================
// CAUSASPRO EMAIL INTERCEPTOR - Entry Point
// Uso: npx tsx src/email/index.ts
// ============================================================

export { runEmailCheck } from './modules/orchestrator'
export { parseAsignacionesFromHtml } from './modules/htmlParser'
export type { AsignacionEmail, EmailRunStatus, EmailProcessResult } from './types'

// CLI runner
async function main() {
  const { runEmailCheck } = await import('./modules/orchestrator')
  
  // Verificar variables de entorno
  const requiredVars = ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASSWORD']
  const altVars = ['EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASSWORD']
  
  const hasMain = requiredVars.every(v => process.env[v])
  const hasAlt = altVars.every(v => process.env[v])
  
  if (!hasMain && !hasAlt) {
    console.error('❌ Error: Variables de entorno requeridas para IMAP:')
    console.error('')
    console.error('  IMAP_HOST=mail.cajmetro.cl')
    console.error('  IMAP_USER=pvargas@cajmetro.cl')
    console.error('  IMAP_PASSWORD=tu_contraseña_del_correo')
    console.error('')
    console.error('O en Vercel/GitHub Secrets:')
    console.error('  EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD')
    console.error('')
    console.error('También necesitas:')
    console.error('  NEXT_PUBLIC_SUPABASE_URL=https://ggwpikokzhckjpwyltye.supabase.co')
    console.error('  SUPABASE_SERVICE_ROLE_KEY=tu_key')
    process.exit(1)
  }
  
  // Si se usan las variables alternativas, mapear
  if (!hasMain && hasAlt) {
    process.env.IMAP_HOST = process.env.EMAIL_HOST
    process.env.IMAP_USER = process.env.EMAIL_USER
    process.env.IMAP_PASSWORD = process.env.EMAIL_PASSWORD
  }
  
  console.log('🚀 Iniciando interceptor de correos...')
  console.log('')
  
  const result = await runEmailCheck()
  
  process.exit(result.errores.length > 0 ? 1 : 0)
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Error fatal:', err.message)
    process.exit(1)
  })
}
