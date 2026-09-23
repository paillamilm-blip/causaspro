// ============================================================
// CAUSASPRO - Sacar / volver a poner una causa en monitoreo
// ------------------------------------------------------------
// POR QUÉ EXISTE: el portal del PJUD NO informa cuándo una causa terminó.
// Se verificó con datos reales (23-sep-2026):
//   · causas.estado      → 292 causas dicen literalmente "Sin Estado", el resto vacío.
//   · movimientos.tramite → no hay vocabulario de cierre; las únicas coincidencias con
//                           "archiv/termin/sentencia/cumpl/cierr" (4 movimientos) venían de
//                           6 causas mal scrapeadas de la pestaña Corte Suprema.
//
// O sea que el sistema NO PUEDE deducirlo. La curadora sí lo sabe, porque es ella la que
// trabaja la causa. Por eso esto es una marca MANUAL, no una inferencia.
//
// Es además la pieza que faltaba: aunque más adelante aparezca una señal automática, la
// curadora necesita poder corregirla. Esta marca siempre manda.
// ============================================================

/** Marca que se guarda en `notas` cuando la curadora saca la causa de monitoreo. */
export const MARCA_TERMINADA = '[TERMINADA]'

/**
 * Etapa que usa el portal del PJUD cuando la causa se cerró. ES LA SEÑAL AUTOMÁTICA, y está
 * en `movimientos.etapa` (no en `causas.estado`, que dice "Sin Estado" en 292 causas).
 *
 * Medido sobre datos reales (23-sep-2026): aparece en 167 movimientos de 52 causas, y esas 52
 * la tienen como ÚLTIMO movimiento (47 con trámite "Resolución" + 5 con "Actuación"). Es un
 * estado TERMINAL: después no pasa nada más, así que alcanza con preguntar si la causa tiene
 * algún movimiento en esta etapa.
 *
 * NO confundir con otras etapas que parecen finales y no lo son:
 *   · "Sentencia" (42 causas) → puede seguir el cumplimiento.
 *   · "Incompetencia" (47 causas) → solo 2 la tienen como último movimiento; las otras 45
 *     siguieron tramitando después.
 */
export const ETAPA_TERMINADA = 'Terminada'

/** ¿La curadora sacó esta causa de monitoreo? Tolerante a mayúsculas/espacios. */
export function estaTerminada(notas: string | null | undefined): boolean {
  return (notas ?? '').toUpperCase().includes(MARCA_TERMINADA)
}

/**
 * Agrega la marca de terminada a `notas`, CONSERVANDO todo lo que ya había.
 *
 * CRÍTICO: `notas` es un canal compartido con el bot ([NO EN PORTAL],
 * [REVISAR: no scrapeada], [INTENTOS FALLIDOS: n], [VÍNCULO], [REVISAR LETRA],
 * [ASIGNACIÓN]). Reemplazar el campo rompe la cola del bot y borra los vínculos P↔X, así que
 * SIEMPRE se agrega una línea. Devuelve `null` si ya estaba marcada (no hay nada que escribir).
 */
export function marcarTerminada(notas: string | null | undefined, fechaISO: string): string | null {
  if (estaTerminada(notas)) return null
  const actual = (notas ?? '').trim()
  const linea = `${MARCA_TERMINADA} sacada de monitoreo por la curadora el ${fechaISO}.`
  return actual ? `${actual}\n${linea}` : linea
}

/**
 * Quita la marca de terminada (para reactivar una causa marcada por error), conservando el
 * resto de las líneas en su orden original. Devuelve `null` si no estaba marcada.
 * Puede devolver string vacío si la marca era lo único que había: el llamador decide si
 * guarda null en la columna.
 */
export function desmarcarTerminada(notas: string | null | undefined): string | null {
  if (!estaTerminada(notas)) return null
  return (notas ?? '')
    .split('\n')
    .filter((l) => !l.toUpperCase().includes(MARCA_TERMINADA))
    .join('\n')
    .trim()
}
