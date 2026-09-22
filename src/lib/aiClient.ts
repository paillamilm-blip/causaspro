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

/** Modelos gratuitos de OpenRouter, en orden de preferencia (fallback en cascada).
 *
 *  VERIFICADOS el 22-sep-2026 contra https://openrouter.ai/api/v1/models. Los cinco
 *  cumplen las 3 condiciones que este cliente necesita:
 *    1. el id EXISTE en el catálogo (un id inventado da HTTP 404 y quema un intento),
 *    2. soportan `response_format` (modo JSON),
 *    3. su razonamiento NO es obligatorio (`reasoning.mandatory === false`), así podemos
 *       apagarlo con `reasoning: { enabled: false }` y dedicar todo el presupuesto de
 *       tokens a la RESPUESTA en vez de al "pensamiento" interno.
 *
 *  Orden: primero los dos gemma, que ya vienen con el razonamiento apagado de fábrica
 *  (`default_enabled: false`) y por eso son los más predecibles para devolver JSON.
 *
 *  Descartado a propósito: `liquid/lfm-2.5-2.6b:free` (razonamiento OBLIGATORIO y modelo
 *  muy chico para materia jurídica).
 *
 *  SI ALGÚN DÍA TODOS FALLAN CON "HTTP 404": los ids fueron retirados. Revisar el catálogo
 *  (https://openrouter.ai/api/v1/models) y reemplazarlos por otros `:free` que tengan
 *  `response_format` en `supported_parameters`. */
const MODELOS = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nex-agi/nex-n2.5-mini:free',
  'dots-studio/dots-3-note-preview:free',
]

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const TIMEOUT_MS = 25000

/** Presupuesto de tokens de la respuesta. El análisis pide 6 campos en ESPAÑOL
 *  (resumenCausa, resumenProgramas, resumen, acciones, riesgo, preguntasPrograma).
 *  El español gasta bastantes más tokens que el inglés, así que con un presupuesto chico
 *  el JSON se CORTA a la mitad, `JSON.parse` falla y perdemos el modelo por nada.
 *  Todos los modelos de la lista admiten ≥32k de salida y son gratis: ser generoso acá
 *  no cuesta dinero y evita el error "la IA no pudo analizar". */
const MAX_TOKENS = 2500

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
  resumenCausa?: string        // dónde está parada la causa HOY (recorrido/estado actual)
  resumenProgramas?: string    // qué han dicho/pedido los programas, según los movimientos
}

/** ¿Hay key de OpenRouter configurada? (para fail-safe honesto). */
export function iaDisponible(): boolean {
  return !!process.env.OPENROUTER_KEY
}

/**
 * Extrae el primer objeto JSON con un `resumen` no vacío de un texto. Devuelve null si no
 * hay JSON válido con contenido útil. Sirve para VALIDAR la respuesta de un modelo: algunos
 * modelos "piensan en voz alta" (texto en inglés) o no respetan el formato → esos NO deben
 * aceptarse, hay que probar el siguiente modelo.
 */
function extraerJsonAnalisis(texto: string): any | null {
  const match = texto.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    // Consideramos válida solo si trae al menos un `resumen` con algo de texto real.
    if (obj && typeof obj === 'object' && String(obj.resumen || '').trim().length > 0) return obj
    return null
  } catch {
    return null
  }
}

/**
 * Llama a OpenRouter y devuelve el OBJETO JSON del análisis (ya parseado y validado).
 * Prueba los modelos en orden; pasa al siguiente si: falla la red/HTTP, la respuesta viene
 * vacía, o —clave— NO es un JSON válido con `resumen` (evita que un modelo que "razona en
 * voz alta" o responde en inglés contamine el resultado). Lanza si TODOS fallan.
 */
async function llamarOpenRouter(system: string, user: string): Promise<any> {
  const key = process.env.OPENROUTER_KEY
  if (!key) throw new Error('OPENROUTER_KEY no configurada')

  // Motivo de falla de CADA modelo, en lenguaje corto. Si todos fallan, esto viaja en el
  // error para que la UI pueda mostrar POR QUÉ falló (antes solo se veía "no pudo
  // analizar", que no dice nada y obligaba a leer los logs de Vercel).
  const fallas: string[] = []
  let ultimoError: any = null

  for (const modelo of MODELOS) {
    const corto = modelo.replace(':free', '').split('/').pop() || modelo
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
          temperature: 0.2,
          max_tokens: MAX_TOKENS,
          // Forzar salida JSON: reduce que el modelo devuelva texto/razonamiento libre.
          response_format: { type: 'json_object' },
          // Apagar el "razonamiento". Varios modelos gratis razonan por defecto y esos
          // tokens SE DESCUENTAN de max_tokens: el modelo se gasta el presupuesto pensando
          // y el JSON llega cortado o vacío. Apagado, todo el presupuesto va a la respuesta.
          // Ningún modelo de MODELOS tiene el razonamiento obligatorio, así que es seguro.
          reasoning: { enabled: false },
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) {
        // Log del cuerpo del error de OpenRouter (aparece en los logs de Vercel) para
        // poder diagnosticar: modelo retirado (404), key inválida (401), sin crédito (402),
        // rate-limit (429). No rompe: probamos el siguiente modelo.
        const cuerpo = await res.text().catch(() => '')
        console.warn(`[IA] ${modelo}: HTTP ${res.status} ${cuerpo.slice(0, 300)}`)
        fallas.push(`${corto}: HTTP ${res.status}${res.status === 401 ? ' (key inválida)' : res.status === 402 ? ' (sin crédito)' : res.status === 404 ? ' (modelo retirado)' : res.status === 429 ? ' (límite de uso)' : ''}`)
        ultimoError = new Error(`${modelo}: HTTP ${res.status}`)
        continue // probar siguiente modelo
      }
      const json = await res.json()
      const msg = json?.choices?.[0]?.message
      const finish = json?.choices?.[0]?.finish_reason
      // Algunos modelos devuelven el JSON dentro de `reasoning` en vez de `content`.
      // Probamos content primero y, si no sirve, el reasoning: es respuesta del mismo
      // modelo, solo en otro campo, así que es válida.
      const candidatos = [msg?.content, msg?.reasoning].filter(
        (t): t is string => typeof t === 'string' && t.trim().length > 0,
      )
      if (candidatos.length === 0) {
        // finish_reason === 'length' ⇒ se agotó max_tokens antes de escribir nada útil.
        console.warn(`[IA] ${modelo}: respuesta vacía (finish_reason=${finish})`)
        fallas.push(`${corto}: respuesta vacía${finish === 'length' ? ' (se cortó por largo)' : ''}`)
        ultimoError = new Error(`${modelo}: respuesta vacía`)
        continue
      }
      // VALIDAR que sea JSON útil. Si el modelo respondió con razonamiento/inglés/sin JSON,
      // NO lo aceptamos: probamos el siguiente modelo (evita el "genérico" del fallback).
      const obj = candidatos.map(extraerJsonAnalisis).find((o) => o !== null)
      if (!obj) {
        console.warn(`[IA] ${modelo}: sin JSON válido (finish_reason=${finish}). Probando siguiente modelo.`)
        fallas.push(`${corto}: sin JSON válido${finish === 'length' ? ' (JSON cortado por largo)' : ''}`)
        ultimoError = new Error(`${modelo}: sin JSON válido`)
        continue
      }
      console.log(`[IA] análisis OK con ${modelo}`)
      return obj
    } catch (e: any) {
      clearTimeout(timer)
      const esTimeout = e?.name === 'AbortError'
      console.warn(`[IA] ${modelo}: ${esTimeout ? 'timeout' : e?.message || e}`)
      fallas.push(`${corto}: ${esTimeout ? `timeout (${TIMEOUT_MS / 1000}s)` : String(e?.message || e).slice(0, 80)}`)
      ultimoError = e
      // AbortError (timeout) o error de red → probar siguiente modelo.
    }
  }
  // Todos fallaron: propagar un error que LLEVA el detalle por modelo, para que el API
  // route lo muestre en pantalla y se pueda diagnosticar sin entrar a los logs.
  const err: any = ultimoError || new Error('Todos los modelos de IA fallaron')
  err.detalle = fallas.join(' · ')
  throw err
}

/**
 * Convierte el OBJETO JSON ya validado (que devuelve llamarOpenRouter) al AnalisisCausa
 * tipado, con defaults seguros. La validación de "es JSON con resumen" ya la hizo
 * llamarOpenRouter; acá solo normalizamos campos.
 */
function parsearAnalisis(obj: any): AnalisisCausa {
  // Normaliza a lista de strings limpios (acepta array o string suelto), sin vacíos.
  const aLista = (v: any): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 4)
    if (typeof v === 'string' && v.trim()) return [v.trim()]
    return []
  }
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
    resumenCausa: String(obj.resumenCausa || obj.resumen_causa || '').trim() || undefined,
    resumenProgramas: String(obj.resumenProgramas || obj.resumen_programas || '').trim() || undefined,
  }
}

/**
 * Analiza una causa a partir de un contexto ya armado (texto), devolviendo
 * resumen + próximo paso + riesgo. El llamador (API route) construye `contexto`
 * SIN PII innecesaria (ver /api/analisis).
 */
export async function analizarCausaIA(contexto: string): Promise<AnalisisCausa> {
  const system = [
    'IMPORTANTE: responde SIEMPRE en ESPAÑOL y ÚNICAMENTE con el objeto JSON pedido. NO escribas tu razonamiento, NO expliques tus pasos, NO uses inglés, NO agregues texto antes ni después del JSON. Empieza directamente con "{".',
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
    'Sobre "resumenProgramas": resume qué han informado o SOLICITADO los programas ejecutores (OPD, PPF, PIE, PRM, DAM, etc.) SEGÚN LO QUE DIGAN LAS DESCRIPCIONES de los movimientos. Si las descripciones no detallan el contenido de los informes, dilo explícitamente (ej. "consta ingreso de informes del PPF pero sin detalle en el sistema"). NO inventes lo que diría un informe que no está en el contexto.',
    'Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, con EXACTAMENTE estas claves:',
    '{',
    '"resumenCausa": "2-3 frases sobre DÓNDE ESTÁ PARADA LA CAUSA HOY: su recorrido resumido y el estado actual, según los movimientos y el estado",',
    '"resumenProgramas": "qué han dicho o pedido los PROGRAMAS ejecutores según las descripciones de los movimientos; si no hay detalle, indícalo; \'\' si no consta intervención de programas",',
    '"resumen": "2-3 frases concretas sobre el estado de la protección del NNA y el cumplimiento de la medida, citando el dato que lo respalda",',
    '"acciones": ["2 a 3 gestiones de CURADURÍA priorizadas (la primera = la más urgente), concretas y ancladas a un dato de la causa, en tono tentativo (\'convendría…\', \'sería recomendable evaluar…\')"],',
    '"riesgo": "el principal riesgo para el NNA o punto de cumplimiento/plazo a vigilar, como posibilidad",',
    '"preguntasPrograma": ["1 a 3 preguntas clave que la curadora podría hacerle al programa ejecutor para verificar el cumplimiento; [] si no aplica"]',
    '}',
  ].join(' ')

  const user = `Analiza esta causa de protección desde el rol de CURADORA AD LÍTEM (velar por el NNA y el cumplimiento de la medida) y devuelve el JSON pedido:\n\n${contexto}`

  const obj = await llamarOpenRouter(system, user)
  return parsearAnalisis(obj)
}
