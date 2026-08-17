import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Contar registros en cada tabla
    const [causasRes, nnaRes, adultosRes, audienciasRes, medidasRes] = await Promise.all([
      supabase.from('causas').select('id', { count: 'exact', head: true }),
      supabase.from('nna').select('id', { count: 'exact', head: true }),
      supabase.from('adultos').select('id', { count: 'exact', head: true }),
      supabase.from('audiencias').select('id', { count: 'exact', head: true }),
      supabase.from('medidas_cautelares').select('id', { count: 'exact', head: true }),
    ])

    // Ver audiencias recientes
    const { data: audienciaStats } = await supabase
      .from('audiencias')
      .select('fecha, tipo')
      .order('fecha', { ascending: false })
      .limit(20)

    // Ver ranking actual (sample)
    const { data: rankingSample, error: rankingError } = await supabase
      .from('v_causas_ranking')
      .select('rit, dias_para_audiencia, dias_sin_actividad, nivel_urgencia, proxima_audiencia, ultima_audiencia')
      .limit(10)

    // Distribución de urgencia
    const { data: urgenciaAll } = await supabase
      .from('v_causas_ranking')
      .select('nivel_urgencia')

    const distribucion: Record<string, number> = {}
    if (urgenciaAll) {
      for (const r of urgenciaAll) {
        const key = `nivel_${r.nivel_urgencia}`
        distribucion[key] = (distribucion[key] || 0) + 1
      }
    }

    return NextResponse.json({
      tablas: {
        causas: causasRes.count || 0,
        nna: nnaRes.count || 0,
        adultos: adultosRes.count || 0,
        audiencias: audienciasRes.count || 0,
        medidas_cautelares: medidasRes.count || 0,
      },
      audiencias_recientes: audienciaStats,
      ranking_sample: rankingSample,
      ranking_error: rankingError?.message,
      distribucion_urgencia: distribucion,
      fecha_servidor: new Date().toISOString(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
