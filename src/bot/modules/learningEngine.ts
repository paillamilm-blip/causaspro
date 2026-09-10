// ============================================================
// CAUSASPRO BOT - Motor de Aprendizaje (MODO CONSERVADOR)
// ============================================================
//
// FILOSOFÍA (modo conservador):
//   El bot APRENDE de su propio historial, pero NO cambia su comportamiento
//   automáticamente. Este módulo solo LEE las corridas pasadas, detecta
//   patrones y devuelve RECOMENDACIONES en texto. El humano decide si aplicarlas.
//
//   No toca delays, no cambia el orden de causas, no modifica config. Solo observa.
//   (Cuando quieras pasar a "modo activo", aquí es donde se conectaría la lógica
//    que aplique los ajustes — pero eso es una decisión explícita, no ahora.)
//
// FUENTES DE DATOS (creadas por schema-bot-aprendizaje.sql):
//   • bot_runs           → métricas por sesión (duración, tasa de éxito, bloqueo)
//   • bot_step_metrics   → métricas por etapa (dónde se va el tiempo, dónde falla)
//   • bot_logs           → errores por causa (categorizados)
// ============================================================

import { initSupabase } from './supabaseSync'
import { log } from '../utils'

/** Una recomendación que el bot le hace al humano (no la aplica solo) */
export interface Recomendacion {
  severidad: 'alta' | 'media' | 'baja'
  titulo: string
  detalle: string
  /** Acción sugerida en lenguaje humano (ej: "subir delayMin a 15000") */
  sugerencia: string
}

/** Resumen de salud del bot derivado del historial reciente */
export interface DiagnosticoBot {
  corridas_analizadas: number
  tasa_exito_promedio: number | null
  hubo_bloqueo_reciente: boolean
  paso_mas_problematico: string | null
  recomendaciones: Recomendacion[]
}

/**
 * Analiza el historial reciente y produce un diagnóstico + recomendaciones.
 * Se llama ANTES de cada corrida (para loguear consejos) o bajo demanda.
 * Si no hay datos o la BD no tiene las tablas, devuelve un diagnóstico vacío
 * sin romper el flujo del bot.
 *
 * @param ventanaCorridas  cuántas sesiones recientes mirar (default 20)
 */
export async function analizarHistorial(ventanaCorridas = 20): Promise<DiagnosticoBot> {
  const vacio: DiagnosticoBot = {
    corridas_analizadas: 0,
    tasa_exito_promedio: null,
    hubo_bloqueo_reciente: false,
    paso_mas_problematico: null,
    recomendaciones: [],
  }

  let sb
  try {
    sb = initSupabase()
  } catch {
    return vacio
  }

  // 1. Últimas corridas
  const { data: runs, error: runsErr } = await sb
    .from('bot_runs')
    .select('tasa_exito, bloqueo_detectado, causas_por_min, detenido_por, fallidas, procesadas')
    .order('started_at', { ascending: false })
    .limit(ventanaCorridas)

  if (runsErr || !runs || runs.length === 0) {
    // Sin historial todavía (o faltan columnas). No es un error: el bot recién empieza.
    return vacio
  }

  const recomendaciones: Recomendacion[] = []

  // Tasa de éxito promedio (tolera filas viejas sin tasa_exito)
  const tasas = runs
    .map((r: any) => (typeof r.tasa_exito === 'number' ? r.tasa_exito : null))
    .filter((t): t is number => t !== null)
  const tasaProm = tasas.length > 0 ? tasas.reduce((a, b) => a + b, 0) / tasas.length : null

  const huboBloqueo = runs.some((r: any) => r.bloqueo_detectado === true || r.detenido_por === 'captcha' || r.detenido_por === 'bloqueado')

  // 2. Fallos por paso (últimos 14 días) — vista v_bot_fallos_por_paso
  let pasoProblematico: string | null = null
  const { data: fallos } = await sb
    .from('v_bot_fallos_por_paso')
    .select('paso, tipo_error, ocurrencias')
    .order('ocurrencias', { ascending: false })
    .limit(5)

  if (fallos && fallos.length > 0) {
    pasoProblematico = fallos[0].paso
  }

  // ---- REGLAS DE RECOMENDACIÓN (simples, explicables, sin aplicar nada) ----

  // A. Señal de bloqueo/CAPTCHA → lo más importante para un bot anti-detección
  if (huboBloqueo) {
    recomendaciones.push({
      severidad: 'alta',
      titulo: 'Se detectó bloqueo/CAPTCHA en corridas recientes',
      detalle: 'El portal PJUD mostró señales de bloqueo. Bajar el ritmo reduce el riesgo.',
      sugerencia: 'Considerá subir delayMin/delayMax (ej: 15000/30000), bajar BOT_MAX_CAUSAS a ~15 y pausar 1-2 horas antes de reintentar.',
    })
  }

  // B. Tasa de éxito baja
  if (tasaProm !== null && tasaProm < 70) {
    recomendaciones.push({
      severidad: tasaProm < 40 ? 'alta' : 'media',
      titulo: `Tasa de éxito baja (${tasaProm.toFixed(0)}%)`,
      detalle: 'Muchas causas están fallando respecto a las procesadas.',
      sugerencia: pasoProblematico
        ? `El paso que más falla es "${pasoProblematico}". Revisá los selectores/timeout de esa etapa.`
        : 'Revisá los errores recientes en la vista v_bot_errores para ubicar la causa.',
    })
  }

  // C. Un paso concentra los fallos por timeout → subir timeout de esa etapa
  const falloTimeout = (fallos || []).find((f: any) => f.tipo_error === 'timeout' && f.ocurrencias >= 3)
  if (falloTimeout) {
    recomendaciones.push({
      severidad: 'media',
      titulo: `Timeouts repetidos en "${falloTimeout.paso}"`,
      detalle: `${falloTimeout.ocurrencias} timeouts en el paso "${falloTimeout.paso}" en los últimos 14 días.`,
      sugerencia: 'Considerá subir navigationTimeout/selectorTimeout, o revisar si el portal cambió de estructura.',
    })
  }

  // D. Todo bien → refuerzo positivo (para que el log no sea solo malas noticias)
  if (recomendaciones.length === 0 && tasaProm !== null && tasaProm >= 90) {
    recomendaciones.push({
      severidad: 'baja',
      titulo: 'El bot va sano',
      detalle: `Tasa de éxito ${tasaProm.toFixed(0)}% sin bloqueos recientes. No se sugieren cambios.`,
      sugerencia: 'Mantener la configuración actual.',
    })
  }

  return {
    corridas_analizadas: runs.length,
    tasa_exito_promedio: tasaProm,
    hubo_bloqueo_reciente: huboBloqueo,
    paso_mas_problematico: pasoProblematico,
    recomendaciones,
  }
}

/**
 * Imprime el diagnóstico en consola de forma legible. Pensado para llamarse
 * al inicio de cada sesión, para que el operador vea los consejos del bot.
 * NO aplica ningún cambio (modo conservador).
 */
export function logDiagnostico(diag: DiagnosticoBot): void {
  if (diag.corridas_analizadas === 0) {
    log('info', '🧠 Aprendizaje: aún no hay historial suficiente (primera(s) corrida(s)).')
    return
  }

  log('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  log('info', `🧠 Diagnóstico del bot (últimas ${diag.corridas_analizadas} corridas)`)
  if (diag.tasa_exito_promedio !== null) {
    log('info', `   Tasa de éxito promedio: ${diag.tasa_exito_promedio.toFixed(0)}%`)
  }
  if (diag.paso_mas_problematico) {
    log('info', `   Paso más problemático: ${diag.paso_mas_problematico}`)
  }
  if (diag.hubo_bloqueo_reciente) {
    log('warn', '   ⚠️ Hubo señales de bloqueo/CAPTCHA recientes')
  }

  if (diag.recomendaciones.length === 0) {
    log('info', '   Sin recomendaciones.')
  } else {
    log('info', '   Recomendaciones (NO se aplican solas — decisión tuya):')
    const icon = { alta: '🔴', media: '🟡', baja: '🟢' }
    for (const r of diag.recomendaciones) {
      log('info', `   ${icon[r.severidad]} ${r.titulo}`)
      log('info', `      → ${r.sugerencia}`)
    }
  }
  log('info', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}
