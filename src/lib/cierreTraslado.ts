// ============================================================
// CIERE DEL TRIBUNAL tras enviar el escrito de traslado
// ============================================================
// Regla de curaduría (criterio de Paula): cuando el tribunal confiere traslado, ella
// presenta el escrito; desde ese momento el tribunal queda en "cierra el tribunal" y se
// demora ~14 días. Hasta hoy el panel no tenía forma de saber si YA lo había enviado,
// así que la causa seguía contando como "traslado pendiente" aunque ya estuviera hecha.
//
// Este módulo es PURO (sin React ni Supabase), como seguimientoNna.ts: recibe la lista
// de gestiones de una causa y responde la fecha del último escrito de traslado.
//
// Dónde vive el dato: UNA FILA MÁS en la bitácora de la causa (tabla `gestiones`), con
// tipo 'Presentación de escrito' (ya existía en TIPOS_GESTION) y la marca
// MARCA_ESCRITO_TRASLADO al comienzo del `contenido`. La FECHA es la columna `fecha` de
// la gestión — no se parsea de texto. Si mañana el portal informa la resolución del
// traslado, eso manda sobre el plazo estimado (ver aviso en el panel).

/** Marca que identifica, dentro de `gestiones.contenido`, que el escrito era la respuesta al traslado. */
export const MARCA_ESCRITO_TRASLADO = '[ESCRITO TRASLADO]'

/** Tipo de gestión (coincide con TIPOS_GESTION de la ficha de causa). */
export const TIPO_ESCRITO = 'Presentación de escrito'

/** Plazo de cierre del tribunal, en días, desde el envío del escrito. Criterio de Paula: 14 fijos. */
export const DIAS_PLAZO_CIERRE = 14

// Forma mínima de una gestión para este módulo. `id` y `contenido` solo las usa el
// Dashboard para poder deshacer el marcado (hay que saber QUÉ fila borrar).
export interface GestionEscrito {
  id?: string | null
  tipo: string | null
  fecha: string | null
  contenido?: string | null
}

/** ¿Es esta gestión un escrito de traslado? (tolerante a espacios/mayúsculas) */
export function esEscritoTraslado(g: GestionEscrito): boolean {
  return (g.contenido ?? '').toUpperCase().includes(MARCA_ESCRITO_TRASLADO)
}

/**
 * El escrito de traslado MÁS RECENTE de una causa: su fecha y el id de la gestión (para
 * poder borrarla si la curadora se arrepiente). Devuelve null si no hay ninguno.
 */
export function escritoTrasladoMasReciente(
  gestiones: readonly GestionEscrito[],
): { id: string | null; fecha: string } | null {
  let mejor: { id: string | null; fecha: string } | null = null
  for (const g of gestiones) {
    if (!esEscritoTraslado(g)) continue
    // Solo fechas ISO "YYYY-MM-DD" (columna DATE de Postgres); cualquier raro se descarta.
    if (!g.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(g.fecha)) continue
    if (!mejor || g.fecha > mejor.fecha) mejor = { id: g.id ?? null, fecha: g.fecha }
  }
  return mejor
}

/**
 * Estado del cierre esperando al tribunal para una causa.
 * diasRestantes > 0 → aún dentro del plazo; 0 → cumple el plazo HOY; < 0 → vencido
 * (toca preguntar por resolución). `vencido` es estrictamente pasado el plazo: el día 14
 * en sí todavía es día hábil de espera, no una alarma.
 */
export interface EstadoCierreTraslado {
  fechaEnvio: string
  diasTranscurridos: number
  diasRestantes: number
  vencido: boolean
}

export function estadoCierreTraslado(
  fechaEnvio: string,
  ahora: Date = new Date(),
): EstadoCierreTraslado {
  const [y, m, d] = fechaEnvio.split('-').map(Number)
  const inicio = new Date(y, m - 1, d)
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  const diasTranscurridos = Math.max(0, Math.floor((hoy.getTime() - inicio.getTime()) / 86_400_000))
  const diasRestantes = DIAS_PLAZO_CIERRE - diasTranscurridos
  return { fechaEnvio, diasTranscurridos, diasRestantes, vencido: diasRestantes < 0 }
}

/**
 * Texto del plazo, en lenguaje de curadora.
 * Dentro del plazo: "Quedan 9 días" (y "Queda 1 día"). Al cumplirse los 14: "Cierra hoy".
 * Pasados: "Venció hace 3 días". Nunca "vence hoy hace 0 días".
 */
export function textoCierreTraslado(e: EstadoCierreTraslado): string {
  if (e.diasRestantes === 1) return 'Queda 1 día'
  if (e.diasRestantes > 1) return `Quedan ${e.diasRestantes} días`
  if (e.diasRestantes === 0) return 'Cierra hoy'
  const vencidos = -e.diasRestantes
  return vencidos === 1 ? 'Venció hace 1 día' : `Venció hace ${vencidos} días`
}

/** Texto breve para el chip del panel: "Cierre en 9 días" / "Cierra hoy" / "Cierre vencido". */
export function textoChipCierre(e: EstadoCierreTraslado): string {
  if (e.diasRestantes > 0) return `Cierre en ${e.diasRestantes} ${e.diasRestantes === 1 ? 'día' : 'días'}`
  if (e.diasRestantes === 0) return 'Cierra hoy'
  return 'Cierre vencido — revisar'
}
