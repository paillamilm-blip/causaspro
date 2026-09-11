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

/** Modelos gratuitos de OpenRouter, en orden de preferencia (fallback en cascada). */
const MODELOS = [
  'google/gemma-2-9b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen-2.5-72b-instruct:free',
]

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const TIMEOUT_MS = 25000

/** Resultado estructurado del análisis estratégico de una causa. */
export interface AnalisisCausa {
  resumen: string        // 2-3 líneas: en qué estado está la causa
  proximoPaso: string    // acción concreta sugerida
  riesgo: string         // riesgo/urgencia principal a vigilar
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
          max_tokens: 700,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) {
        ultimoError = new Error(`${modelo}: HTTP ${res.status}`)
        continue // probar siguiente modelo
      }
      const json = await res.json()
      const texto = json?.choices?.[0]?.message?.content
      if (typeof texto === 'string' && texto.trim()) return texto.trim()
      ultimoError = new Error(`${modelo}: respuesta vacía`)
    } catch (e: any) {
      clearTimeout(timer)
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
  try {
    const match = texto.match(/\{[\s\S]*\}/)
    if (match) {
      const obj = JSON.parse(match[0])
      return {
        resumen: String(obj.resumen || '').trim() || 'Sin resumen.',
        proximoPaso: String(obj.proximoPaso || obj.proximo_paso || '').trim() || 'Revisar la causa.',
        riesgo: String(obj.riesgo || '').trim() || 'Sin riesgo identificado.',
      }
    }
  } catch {
    // cae al fallback de abajo
  }
  return { resumen: texto.slice(0, 500), proximoPaso: 'Revisar la causa con detalle.', riesgo: 'No determinado.' }
}

/**
 * Analiza una causa a partir de un contexto ya armado (texto), devolviendo
 * resumen + próximo paso + riesgo. El llamador (API route) construye `contexto`
 * SIN PII innecesaria (ver /api/analisis).
 */
export async function analizarCausaIA(contexto: string): Promise<AnalisisCausa> {
  const system = [
    'Eres un asistente jurídico que apoya a un abogado en causas de FAMILIA y PROTECCIÓN de NNA en Chile.',
    'Analizas el estado procesal de una causa a partir de sus movimientos/audiencias y ofreces SUGERENCIAS.',
    'Tu tono es profesional y claro, en español de Chile.',
    'REGLAS ESTRICTAS:',
    '- SUGIERES, NO decides ni ordenas. Usa lenguaje tentativo ("podría convenir", "sería recomendable evaluar"), NUNCA imperativo ("presente", "solicite") ni afirmaciones categóricas.',
    '- NUNCA afirmes certezas legales, plazos exactos ni consecuencias como hechos seguros; enmárcalo como posibilidad a verificar por el abogado.',
    '- NO inventes datos que no estén en el contexto. Si falta información, dilo.',
    '- El abogado es quien decide; tú solo aportas una lectura preliminar.',
    'Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, con exactamente estas claves:',
    '{"resumen": "2-3 frases sobre el estado actual de la causa", "proximoPaso": "una acción que el abogado PODRÍA evaluar (en tono tentativo)", "riesgo": "el principal riesgo o plazo a vigilar, como posibilidad"}',
  ].join(' ')

  const user = `Analiza esta causa de familia y devuelve el JSON pedido:\n\n${contexto}`

  const texto = await llamarOpenRouter(system, user)
  return parsearAnalisis(texto)
}
