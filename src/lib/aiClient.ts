// ============================================================
// CAUSASPRO - Cliente de IA (OpenRouter) — OPCIONAL
// Enriquece la interpretacion heuristica del copiloto con lenguaje natural.
// Si no hay OPENROUTER_KEY o la llamada falla, devuelve null y el copiloto
// usa el motor heuristico. NUNCA lanza: degrada de forma silenciosa.
// ============================================================

import type { Decision, MovimientoInput } from './copiloto'

// Modelos gratis de OpenRouter con fallback en cascada (patron Omicron).
const MODELOS = [
  'google/gemma-2-9b-it:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
]

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const TIMEOUT_MS = 12000

/** True si hay API key configurada (server-side). */
export function isAIEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_KEY)
}

/** Campos que la IA puede refinar sobre la decision heuristica. */
export interface AIEnriquecimiento {
  titulo?: string
  explicacion?: string
  accion?: string
  riesgo?: string
}

/**
 * Pide a la IA que reescriba la interpretacion de un movimiento en lenguaje
 * claro y cercano (tono mentor, espanol de Chile). Devuelve null si no hay key
 * o si algo falla — el llamador debe caer al heuristico.
 *
 * @param movimiento el movimiento del PJUD
 * @param base la decision heuristica ya calculada (da contexto y estructura)
 */
export async function enriquecerDecision(
  movimiento: MovimientoInput,
  base: Decision
): Promise<AIEnriquecimiento | null> {
  const key = process.env.OPENROUTER_KEY
  if (!key) return null

  const prompt = construirPrompt(movimiento, base)

  for (const modelo of MODELOS) {
    try {
      const resp = await fetchConTimeout(
        OPENROUTER_URL,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'X-Title': 'CausasPro Copiloto',
          },
          body: JSON.stringify({
            model: modelo,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 400,
            response_format: { type: 'json_object' },
          }),
        },
        TIMEOUT_MS
      )

      if (!resp.ok) {
        // 429/5xx: probar siguiente modelo
        continue
      }

      const data = await resp.json()
      const content: string | undefined = data?.choices?.[0]?.message?.content
      if (!content) continue

      const parsed = parseRespuesta(content)
      if (parsed) return parsed
    } catch {
      // timeout / red / json: probar siguiente modelo
      continue
    }
  }

  return null
}

const SYSTEM_PROMPT = `Eres un asistente legal chileno experto en procedimiento.
Traduces movimientos judiciales del Poder Judicial de Chile a lenguaje claro para un abogado ocupado.
Tono: cercano, directo, de mentor. Espanol de Chile. Sin tecnicismos innecesarios.
Respondes SIEMPRE en JSON valido con las claves: titulo, explicacion, accion, riesgo.
No inventes plazos ni datos que no esten en el movimiento.`

function construirPrompt(m: MovimientoInput, base: Decision): string {
  return `Movimiento del PJUD:
- Tramite: ${m.tramite || '(sin detalle)'}
- Descripcion: ${m.descripcion || '(sin descripcion)'}
- Etapa: ${m.etapa || '(sin etapa)'}

Interpretacion base (heuristica) que puedes mejorar:
- Titulo: ${base.titulo}
- Explicacion: ${base.explicacion}
- Accion sugerida: ${base.accion}
- Riesgo: ${base.riesgo}
${base.plazoDiasHabiles != null ? `- Plazo: ${base.plazoDiasHabiles} dias habiles (vence ${base.fechaLimite})` : ''}

Reescribe titulo, explicacion, accion y riesgo de forma clara y accionable.
Manten cualquier plazo tal cual (no lo cambies). Devuelve solo el JSON.`
}

function parseRespuesta(content: string): AIEnriquecimiento | null {
  try {
    // Algunos modelos envuelven el JSON en ```json ... ```
    const limpio = content.replace(/```json\s*|\s*```/g, '').trim()
    const obj = JSON.parse(limpio)
    const out: AIEnriquecimiento = {}
    if (typeof obj.titulo === 'string') out.titulo = obj.titulo.trim()
    if (typeof obj.explicacion === 'string') out.explicacion = obj.explicacion.trim()
    if (typeof obj.accion === 'string') out.accion = obj.accion.trim()
    if (typeof obj.riesgo === 'string') out.riesgo = obj.riesgo.trim()
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

function fetchConTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(t))
}
