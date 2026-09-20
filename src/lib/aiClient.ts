// ============================================================
// CAUSASPRO - Cliente IA (OpenRouter) para análisis estratégico de causas
// ------------------------------------------------------------
// SERVER-SIDE ONLY. Usa OPENROUTER_KEY (nunca exponer al browser).
// Llama a modelos gratuitos de OpenRouter con fallback: si uno falla o da 429,
// intenta el siguiente. Timeout por intento para no colgar la request.
//
// FILOSOFÍA: la IA SUGIERE, no decide. El resultado siempre se presenta como
// una recomendación a revisar con criterio profesional (disclaimer en la UI).
// ============================================================

/** Modelos gratuitos VIGENTES de OpenRouter (verificados ago-2026), en orden de
 *  preferencia (fallback en cascada). Solo Google (gemma) y NVIDIA (nemotron): los
 *  tiers gratuitos de meta-llama/qwen/mistral fueron retirados. Si uno da 429/error,
 *  se pasa al siguiente. Son los mismos modelos que ya funcionan en producción. */
const MODELOS = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-3n-e4b-it:free',
]

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const TIMEOUT_MS = 25000

/** Resultado estructurado del análisis estratégico de una causa.
 *  `resumen`, `proximoPaso` y `riesgo` se mantienen por compatibilidad con el frontend.
 *  `acciones` y `preguntasPrograma` son los campos nuevos que hacen el análisis accionable:
 *  el frontend los muestra si vienen; si no, cae al proximoPaso clásico (degradación). */
export interface AnalisisCausa {
  resumen: string              // 2-3 líneas: estado de la protección y del cumplimiento
  proximoPaso: string          // acción principal sugerida (compat; = acciones[0] si hay)
  riesgo: string               // riesgo/plazo principal a vigilar
  acciones?: string[]          // 2-3 gestiones de curaduría priorizadas (la 1ª es la más urgente)
  preguntasPrograma?: string[] // preguntas clave que la curadora podría hacerle al programa
}

/** ¿Hay key de OpenRouter configurada? (para fail-safe honesto). */
export function iaDisponible(): boolean {
  return !!process.env.OPENROUTER_KEY
}

/**
 * Llama a OpenRouter con un prompt y devuelve el texto de la respuesta.
 * Prueba los modelos en orden; si uno falla (error de red, 429, 5xx) pasa al
 * siguiente. Lanza si TODOS fallan.
 */
async function llamarOpenRouter(system: string, user: string): Promise<string> {
  const key = process.env.OPENROUTER_KEY
  if (!key) throw new Error('OPENROUTER_KEY no configurada')

  let ultimoError: any = null
  for (const modelo of MODELOS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelo,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) {
        // Log del cuerpo del error de OpenRouter (aparece en los logs de Vercel) para
        // poder diagnosticar: modelo retirado (404), key inválida (401), sin crédito (402),
        // rate-limit (429). No rompe: probamos el siguiente modelo.
        const detalle = await res.text().catch(() => '')
        console.warn(`[IA] ${modelo}: HTTP ${res.status} ${detalle.slice(0, 200)}`)
        ultimoError = new Error(`${modelo}: HTTP ${res.status}`)
        continue // probar siguiente modelo
      }
      const json = await res.json()
      const texto = json?.choices?.[0]?.message?.content
      if (typeof texto === 'string' && texto.trim()) return texto.trim()
      console.warn(`[IA] ${modelo}: respuesta vacía o sin content`)
      ultimoError = new Error(`${modelo}: respuesta vacía`)
    } catch (e: any) {
      clearTimeout(timer)
      console.warn(`[IA] ${modelo}: ${e?.name === 'AbortError' ? 'timeout' : e?.message || e}`)
      ultimoError = e
      // AbortError (timeout) o error de red → probar siguiente modelo.
    }
  }
  throw ultimoError || new Error('Todos los modelos de IA fallaron')
}

/**
 * Extrae un JSON {resumen, proximoPaso, riesgo} del texto del modelo. Los modelos a veces
 * envuelven el JSON en ```json ... ``` o agregan texto; se extrae el primer objeto {...}.
 * Si no se puede parsear, se usa el texto crudo como resumen (degradación elegante).
 */
function parsearAnalisis(texto: string): AnalisisCausa {
  // Normaliza a lista de strings limpios (acepta array o string suelto), sin vacíos.
  const aLista = (v: any): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 4)
    if (typeof v === 'string' && v.trim()) return [v.trim()]
    return []
  }
  try {
    const match = texto.match(/\{[\s\S]*\}/)
    if (match) {
      const obj = JSON.parse(match[0])
      const acciones = aLista(obj.acciones)
      const preguntasPrograma = aLista(obj.preguntasPrograma || obj.preguntas_programa || obj.preguntas)
      // proximoPaso (compat): explícito, o la primera acción priorizada, o fallback.
      const proximoPaso = String(obj.proximoPaso || obj.proximo_paso || '').trim()
        || acciones[0]
        || 'Revisar el estado de la medida y el cumplimiento del programa.'
      return {
        resumen: String(obj.resumen || '').trim() || 'Sin información suficiente sobre el estado de la protección.',
        proximoPaso,
        riesgo: String(obj.riesgo || '').trim() || 'Sin alerta de cumplimiento identificada.',
        acciones: acciones.length ? acciones : undefined,
        preguntasPrograma: preguntasPrograma.length ? preguntasPrograma : undefined,
      }
    }
  } catch {
    // cae al fallback de abajo
  }
  return { resumen: texto.slice(0, 500), proximoPaso: 'Revisar el estado de la medida y el cumplimiento del programa.', riesgo: 'No determinado.' }
}

/**
 * Analiza una causa a partir de un contexto ya armado (texto), devolviendo
 * resumen + próximo paso + riesgo. El llamador (API route) construye `contexto`
 * SIN PII innecesaria (ver /api/analisis).
 */
export async function analizarCausaIA(contexto: string): Promise<AnalisisCausa> {
  const system = [
    'Eres el asesor de una CURADORA AD LÍTEM de causas de PROTECCIÓN de niños, niñas y adolescentes (NNA) en Tribunales de Familia de Chile.',
    'Tu marco es el INTERÉS SUPERIOR DEL NIÑO. NO piensas como abogado litigante: no te enfocas en escritos, demandas ni estrategia procesal contenciosa.',
    'Piensas como CURADORA: tu trabajo es REPRESENTAR y VELAR por el NNA. Eso significa vigilar que se CUMPLAN las medidas de protección decretadas, coordinar con los PROGRAMAS que las ejecutan (OPD, PPF, PIE, PRM, DAM, residencias, programas ambulatorios), hacer SEGUIMIENTO del bienestar real del NNA (entrevistas/visitas) y alertar al tribunal si algo no se cumple o el NNA está en riesgo.',
    'Tu tono es profesional, humano y claro, en español de Chile.',
    'ÁMBITO: causas JUDICIALIZADAS de baja y media complejidad. (OLN = no judicializada; residencia/alta complejidad la ve otro programa — no es tu ámbito.)',
    'CÓMO RAZONAS (enfoque curador). SEÑALES DE ALERTA a detectar en los movimientos:',
    '- ORDEN DE BÚSQUEDA decretada: es lo más grave (el NNA no está ubicado); requiere acción inmediata.',
    '- Derivado a un programa pero SIN RESPUESTA del programa en más de 6 meses: convendría requerir informe.',
    '- El programa informa NO ADHERENCIA (inasistencia/abandono): convendría coordinar reunión técnica o evaluar re-derivación.',
    '- SIN MOVIMIENTO en más de 6 meses: causa estancada; convendría impulsarla o requerir estado.',
    '- TRASLADO al curador y CITACIÓN a audiencia: trámites que requieren tu atención/ponderación.',
    'GESTIONES POSIBLES DE CURADURÍA que puedes sugerir: requerir informe al programa, coordinar reunión técnica, contactar al adulto responsable, presentar escrito, ponderar solicitudes de las partes; y —solo cuando aporte a que el TRIBUNAL RESUELVA— sugerir recoger la opinión del NNA mediante entrevista (ideal cada 3-4 meses, pero en la práctica solo si es necesario para la decisión judicial).',
    'REGLAS ESTRICTAS:',
    '- SUGIERES, NO decides ni ordenas. Lenguaje tentativo ("podría convenir", "sería recomendable evaluar", "convendría coordinar"), NUNCA imperativo ni afirmaciones categóricas.',
    '- NUNCA afirmes certezas legales, plazos exactos ni consecuencias como hechos seguros; enmárcalo como posibilidad a verificar por la curadora.',
    '- Prioriza gestiones propias de la CURADURÍA (informe del programa, reunión técnica, entrevista de seguimiento con el NNA, verificación de cumplimiento, revisión de la medida) por sobre gestiones puramente procesales de abogado litigante.',
    '- NO inventes datos que no estén en el contexto. Si falta información (ej. no consta informe reciente), dilo como observación.',
    '- La curadora es quien decide; tú aportas una lectura preliminar centrada en el NNA.',
    'SÉ ESPECÍFICO: apóyate en los movimientos y su DESCRIPCIÓN concretos del contexto (fechas, programa, qué informó, qué se resolvió). NO des consejos genéricos que servirían para cualquier causa; menciona el dato puntual que motiva cada sugerencia. Si el contexto no alcanza para ser específico, dilo.',
    'Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, con EXACTAMENTE estas claves:',
    '{',
    '"resumen": "2-3 frases concretas sobre el estado de la protección del NNA y el cumplimiento de la medida, citando el dato que lo respalda",',
    '"acciones": ["2 a 3 gestiones de CURADURÍA priorizadas (la primera = la más urgente), concretas y ancladas a un dato de la causa, en tono tentativo (\'convendría…\', \'sería recomendable evaluar…\')"],',
    '"riesgo": "el principal riesgo para el NNA o punto de cumplimiento/plazo a vigilar, como posibilidad",',
    '"preguntasPrograma": ["1 a 3 preguntas clave que la curadora podría hacerle al programa ejecutor para verificar el cumplimiento; [] si no aplica"]',
    '}',
  ].join(' ')

  const user = `Analiza esta causa de protección desde el rol de CURADORA AD LÍTEM (velar por el NNA y el cumplimiento de la medida) y devuelve el JSON pedido:\n\n${contexto}`

  const texto = await llamarOpenRouter(system, user)
  return parsearAnalisis(texto)
}
