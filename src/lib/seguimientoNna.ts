// ============================================================
// CAUSASPRO - Seguimiento del NNA (curaduría ad lítem)
// ------------------------------------------------------------
// El curador ad lítem debe entrevistar/visitar al NNA de forma periódica. Si pasó
// demasiado tiempo desde la última "Entrevista al NNA" registrada por Paula (en la
// bitácora de gestiones), la causa necesita atención AUNQUE el portal no muestre
// movimientos nuevos: el deber de seguimiento es de la curadora, no del tribunal.
//
// Este módulo es lógica PURA (sin red ni BD): recibe la fecha de la última entrevista
// y devuelve el estado del seguimiento. Así lo comparten el dashboard (chip + KPI) y
// la página de detalle, y es fácil de razonar/testear.
// ============================================================

/** Tipo de gestión que cuenta como "visita/entrevista al NNA".
 *  Debe coincidir con la opción del formulario en la página de detalle de causa
 *  (TIPOS_GESTION[0] = 'Entrevista al NNA'). */
export const TIPO_GESTION_ENTREVISTA = 'Entrevista al NNA'

/** Umbral por defecto (días) para considerar el seguimiento VENCIDO.
 *  90 días ≈ 3 meses: criterio conservador de periodicidad de visita al NNA.
 *  Centralizado acá para poder ajustarlo en un solo lugar. */
export const DIAS_SEGUIMIENTO_VENCIDO = 90

/** Estado del seguimiento del NNA para una causa. */
export interface EstadoSeguimiento {
  /** true si la causa requiere una visita/entrevista al NNA (vencido o nunca registrada). */
  vencido: boolean
  /** Días desde la última entrevista al NNA. null si NUNCA se registró una.
   *  Nunca es negativo hacia afuera: una fecha futura se marca aparte con `fechaFutura`. */
  diasDesdeUltima: number | null
  /** true si jamás se registró una entrevista al NNA en la bitácora. */
  sinRegistro: boolean
  /** true si la última entrevista tiene fecha FUTURA (dato dudoso, probable tipeo). */
  fechaFutura: boolean
  /** Fecha (ISO) de la última entrevista al NNA, o null si no hay. */
  ultimaFechaISO: string | null
}

/**
 * Calcula los días transcurridos entre una fecha ISO (puede ser un DATE puro
 * "2026-09-15") y hoy, comparando por DÍA LOCAL para no desfasar por zona horaria.
 * Un DATE puro se ancla a medianoche UTC; en Chile (UTC-3/-4) restar Date.now()
 * podría dar un día de más/menos. Truncamos ambos lados a medianoche local.
 */
export function diasDesde(fechaISO: string | null | undefined, ahora: Date = new Date()): number | null {
  if (!fechaISO) return null
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaISO)
  const d = soloFecha
    ? (() => { const [y, m, dd] = fechaISO.split('-').map(Number); return new Date(y, m - 1, dd) })()
    : new Date(fechaISO)
  if (isNaN(d.getTime())) return null
  const diaLocal = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const ms = diaLocal(ahora) - diaLocal(d)
  // Puede ser NEGATIVO si la fecha es futura (tipeo errado en el formulario): NO lo forzamos a
  // 0 acá para que el llamador pueda detectar el dato dudoso en vez de mostrar "al día hace 0".
  return Math.round(ms / 86400000)
}

/**
 * Estado del seguimiento a partir de la fecha de la última entrevista al NNA.
 *
 * @param ultimaEntrevistaISO fecha ISO de la última "Entrevista al NNA", o null si nunca hubo.
 * @param umbralDias umbral en días para considerar vencido (default 90).
 * @param ahora inyectable para testear.
 */
export function estadoSeguimiento(
  ultimaEntrevistaISO: string | null | undefined,
  umbralDias: number = DIAS_SEGUIMIENTO_VENCIDO,
  ahora: Date = new Date(),
): EstadoSeguimiento {
  const dias = diasDesde(ultimaEntrevistaISO, ahora)
  if (dias == null) {
    // Nunca se registró una entrevista → seguimiento pendiente (no lo tratamos como "sano").
    return { vencido: true, diasDesdeUltima: null, sinRegistro: true, fechaFutura: false, ultimaFechaISO: null }
  }
  if (dias < 0) {
    // Fecha futura (probable tipeo): NO afirmamos "al día". Lo marcamos como pendiente de
    // revisar (vencido=true, fail-safe) y avisamos con fechaFutura para que la UI lo explique.
    return { vencido: true, diasDesdeUltima: null, sinRegistro: false, fechaFutura: true, ultimaFechaISO: ultimaEntrevistaISO ?? null }
  }
  return {
    vencido: dias >= umbralDias,
    diasDesdeUltima: dias,
    sinRegistro: false,
    fechaFutura: false,
    ultimaFechaISO: ultimaEntrevistaISO ?? null,
  }
}

/** Texto corto para el chip / aviso del dashboard. */
export function textoSeguimiento(estado: EstadoSeguimiento): string {
  if (estado.sinRegistro) return 'Sin visita al NNA registrada'
  if (estado.fechaFutura) return 'Fecha de visita al NNA por revisar'
  const d = estado.diasDesdeUltima ?? 0
  const meses = Math.round(d / 30)
  if (meses >= 2) return `Sin visita al NNA hace ${meses} meses`
  return `Sin visita al NNA hace ${d} días`
}

/** Normaliza un texto para comparar tipos de gestión de forma tolerante:
 *  case-insensitive, sin acentos y sin espacios de borde. Así una variante como
 *  'entrevista al nna' o 'Entrevista al NNA ' cuenta igual que el valor canónico.
 *  Se exporta para que TODAS las vistas (dashboard y detalle) usen el MISMO criterio
 *  y no muestren estados contradictorios sobre la misma causa. */
export function normalizarTipoGestion(s: string | null | undefined): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

/** true si el tipo de una gestión corresponde a una "Entrevista al NNA" (match tolerante). */
export function esEntrevistaNna(tipo: string | null | undefined): boolean {
  return normalizarTipoGestion(tipo) === normalizarTipoGestion(TIPO_GESTION_ENTREVISTA)
}

/**
 * A partir de filas de la tabla `gestiones` (solo se necesitan causa_id, tipo, fecha),
 * arma un mapa causa_id → fecha ISO de la ÚLTIMA "Entrevista al NNA".
 * Filtra por tipo de forma tolerante (case-insensitive, ignorando acentos/espacios) por
 * si el dato viniera con variaciones. Se queda con la fecha más reciente por causa.
 */
export function mapaUltimaEntrevista(
  gestiones: { causa_id?: string | null; tipo?: string | null; fecha?: string | null }[],
): Record<string, string> {
  const mapa: Record<string, string> = {}
  for (const g of gestiones) {
    if (!g?.causa_id || !g?.fecha) continue
    if (!esEntrevistaNna(g.tipo)) continue
    const prev = mapa[g.causa_id]
    // Comparamos por string ISO ordenable (YYYY-MM-DD...) o por timestamp como respaldo.
    if (!prev || new Date(g.fecha).getTime() > new Date(prev).getTime()) {
      mapa[g.causa_id] = g.fecha
    }
  }
  return mapa
}
