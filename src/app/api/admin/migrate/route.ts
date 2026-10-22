import { NextRequest, NextResponse } from 'next/server'
import { estaAutorizado } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// ⚠️ OBSOLETO. El SQL que devolvía esta ruta era la versión VIEJA de v_causas_ranking (vista
// suelta). Hoy el panel se apoya en mv_causas_ranking (materialized view) + refresh_ranking(),
// y ese DROP VIEW ... CASCADE desmonta la cadena: el semáforo desaparece.
//
// Se mantiene la ruta por historial, pero requiere token y ya NO devuelve SQL ejecutable:
// responde cuál es el archivo de migración correcto.
export async function GET(req: NextRequest) {
  if (!estaAutorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  return NextResponse.json({
    obsoleto: true,
    advertencia:
      'NO ejecutar el SQL que esta ruta devolvía antes: hace DROP VIEW v_causas_ranking CASCADE y ' +
      'desmonta la materialized view mv_causas_ranking que usa el panel.',
    usar_en_su_lugar: [
      'schema-001-cobertura.sql  → cola de escaneo, cobertura y rastro del bot (es la que falta aplicar)',
      'Los archivos schema-*.sql del repo → historial del semáforo y señales de curaduría',
    ],
    donde: 'Supabase Dashboard → SQL Editor → pegar el archivo → Run',
  })
}
