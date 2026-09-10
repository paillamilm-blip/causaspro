// ============================================================
// CAUSASPRO - Listador de causas cargadas en la BD
// ------------------------------------------------------------
// Utilidad de SOLO LECTURA para elegir un RIT concreto (p. ej. una causa de
// Familia real) que luego se le pasa al bot vía BOT_RIT para diagnosticar.
//
// NO toca el portal PJUD (no hay login, no hay scraping, no hay riesgo de
// CAPTCHA): solo lee la tabla `causas` de Supabase y la imprime en consola.
//
// USO (Windows CMD, en la misma ventana):
//   npx tsx src/bot/listar-causas.ts
//
// Requiere las mismas variables que el bot:
//   SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY
// (si corres el bot normalmente, ya las tienes en tu entorno / .env).
// ============================================================

import { initSupabase } from './modules/supabaseSync'

/** Descripción legible del prefijo/tipo de RIT (foco en Familia). */
function describeTipo(tipo: string | null): string {
  switch ((tipo || '').toUpperCase()) {
    case 'P': return 'Familia (Protección)'
    case 'C': return 'Familia (Contencioso)'
    case 'F': return 'Familia (F)'
    case 'V': return 'Familia (Violencia intrafamiliar)'
    case 'X': return 'Familia (X)'
    case 'Z': return 'Familia (Z)'
    case 'T': return 'Familia (T)'
    case 'FA': return 'Familia (FA)'
    case 'RIT': return 'RIT'
    default: return tipo ? `Otro (${tipo})` : '(sin tipo)'
  }
}

async function main() {
  // Filtro opcional por prefijo: `npx tsx src/bot/listar-causas.ts P`
  const filtroTipo = (process.argv[2] || '').toUpperCase().trim()

  const sb = initSupabase()
  let query = sb
    .from('causas')
    .select('rit, caratulado, tipo, estado, updated_at')
    .not('rit', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (filtroTipo) query = query.eq('tipo', filtroTipo)

  const { data, error } = await query
  if (error) {
    console.error('❌ Error leyendo causas:', error.message)
    process.exit(1)
  }
  if (!data || data.length === 0) {
    console.log('⚠️  No hay causas cargadas en la BD' + (filtroTipo ? ` con tipo "${filtroTipo}"` : '') + '.')
    console.log('    Cargá causas por Excel primero, o quitá el filtro de tipo.')
    process.exit(0)
  }

  // Agrupar por tipo para ver de un vistazo qué hay.
  const porTipo = new Map<string, number>()
  for (const c of data) {
    const t = (c.tipo || '(sin tipo)').toUpperCase()
    porTipo.set(t, (porTipo.get(t) || 0) + 1)
  }

  console.log('\n============================================================')
  console.log(`CAUSAS CARGADAS EN LA BD  (${data.length}${filtroTipo ? `, filtro tipo=${filtroTipo}` : ', las 200 más recientes'})`)
  console.log('============================================================')
  console.log('Resumen por tipo:')
  for (const [t, n] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(10)} ${n.toString().padStart(4)}   ${describeTipo(t)}`)
  }
  console.log('------------------------------------------------------------')
  console.log('RIT                | Tipo                      | Estado          | Caratulado')
  console.log('------------------------------------------------------------')
  for (const c of data) {
    const rit = (c.rit || '').padEnd(18).slice(0, 18)
    const tipo = describeTipo(c.tipo).padEnd(25).slice(0, 25)
    const estado = (c.estado || '-').padEnd(15).slice(0, 15)
    const carat = (c.caratulado || '-').slice(0, 45)
    console.log(`${rit} | ${tipo} | ${estado} | ${carat}`)
  }
  console.log('============================================================')
  console.log('\n👉 Elegí un RIT de Familia y corré el diagnóstico:')
  console.log('   set BOT_DIAG_DETALLE=1')
  console.log('   set BOT_RIT=<el-rit-que-elegiste>')
  console.log('   npm run bot\n')
}

main().catch(err => {
  console.error('❌ Error fatal:', err?.message ?? err)
  process.exit(1)
})
