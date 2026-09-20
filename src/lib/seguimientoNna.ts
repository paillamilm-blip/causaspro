// ============================================================
// SEGUIMIENTO DEL NNA — alerta de "seguimiento vencido"
// ============================================================
// Regla de curaduría (criterio de Paula): la curadora debe entrevistar/ver al NNA
// con cierta periodicidad. Si pasaron MÁS de 180 días (6 meses) desde la última
// gestión del tipo "Entrevista al NNA" —o si NUNCA se registró una— el seguimiento
// del NNA se considera VENCIDO y hay que priorizarlo.
//
// Este módulo es PURO (sin dependencias de React ni de Supabase): recibe las
// gestiones ya cargadas y devuelve el estado. Así lo pueden usar tanto el detalle
// de causa (que ya carga sus gestiones) como el Dashboard (que las trae en bloque).

// Tipo de gestión que cuenta como "ver al NNA". Debe coincidir EXACTAMENTE con el
// valor guardado en la tabla `gestiones` (ver TIPOS_GESTION en causa/[id]/page.tsx).
export const TIPO_ENTREVISTA_NNA = 'Entrevista al NNA'

// Umbral en días: pasado este límite sin una entrevista, el seguimiento está vencido.
// Criterio de Paula: 180 días (6 meses).
export const DIAS_UMBRAL_SEGUIMIENTO = 180

// Forma mínima de una gestión que necesita este módulo. La tabla `gestiones` tiene
// más columnas (id, causa_id, contenido, created_at); acá solo importan tipo y fecha.
export interface GestionSeguimiento {
  tipo: string | null
  // `fecha` es un DATE de Postgres → llega como string "YYYY-MM-DD". Puede venir null.
  fecha: string | null
}

// Estado del seguimiento del NNA para una causa.
export interface EstadoSeguimientoNna {
  // true si el seguimiento está vencido (nunca se entrevistó, o >180 días desde la última).
  vencido: boolean
  // true si NUNCA se registró una "Entrevista al NNA" en la causa.
  nunca: boolean
  // Fecha (string ISO "YYYY-MM-DD") de la última entrevista, o null si nunca hubo.
  ultimaFecha: string | null
  // Días transcurridos desde la última entrevista. null si nunca hubo entrevista.
  diasDesdeUltima: number | null
}

// Parsea una fecha que puede ser un DATE puro ("2026-09-15") o un timestamp completo.
// Un DATE puro se interpreta como fecha LOCAL (no UTC) para no retroceder un día en el
// huso de Chile. Devuelve null si el valor es vacío o inválido. (Mismo criterio que el
// formatFecha del detalle de causa, centralizado acá para reutilizar.)
function parseFecha(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const d = soloFecha
    ? (() => {
        const [y, m, dd] = iso.split('-').map(Number)
        return new Date(y, m - 1, dd)
      })()
    : new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

// Días transcurridos (enteros, sin decimales) entre `fechaISO` y `ahora`. Se comparan a
// medianoche local para contar días de calendario, no fracciones por la hora del día.
// Nunca devuelve negativo (una fecha futura cuenta como 0 días).
function diasTranscurridos(fechaISO: string | null, ahora: Date): number | null {
  const f = parseFecha(fechaISO)
  if (!f) return null
  const inicio = new Date(f.getFullYear(), f.getMonth(), f.getDate())
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  const ms = hoy.getTime() - inicio.getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

// ¿Es una gestión de tipo "Entrevista al NNA"? Comparación tolerante a espacios y
// mayúsculas para no fallar por diferencias tipográficas menores en datos históricos.
function esEntrevistaNna(g: GestionSeguimiento): boolean {
  return (g.tipo ?? '').trim().toLowerCase() === TIPO_ENTREVISTA_NNA.toLowerCase()
}

// Devuelve la fecha (ISO "YYYY-MM-DD") de la última "Entrevista al NNA" entre las
// gestiones dadas, o null si no hay ninguna. No asume orden en la lista de entrada.
export function ultimaEntrevistaNna(gestiones: readonly GestionSeguimiento[]): string | null {
  let mejorISO: string | null = null
  let mejorMs = -Infinity
  for (const g of gestiones) {
    if (!esEntrevistaNna(g)) continue
    const f = parseFecha(g.fecha)
    if (!f) continue
    if (f.getTime() > mejorMs) {
      mejorMs = f.getTime()
      mejorISO = g.fecha
    }
  }
  return mejorISO
}

// Calcula el estado de seguimiento del NNA para una causa a partir de sus gestiones.
// `ahora` es inyectable para poder testear con una fecha fija (por defecto: hoy).
export function estadoSeguimientoNna(
  gestiones: readonly GestionSeguimiento[],
  ahora: Date = new Date(),
): EstadoSeguimientoNna {
  const ultimaFecha = ultimaEntrevistaNna(gestiones)
  if (!ultimaFecha) {
    // Nunca se registró una entrevista → seguimiento vencido por definición.
    return { vencido: true, nunca: true, ultimaFecha: null, diasDesdeUltima: null }
  }
  const diasDesdeUltima = diasTranscurridos(ultimaFecha, ahora)
  const vencido = diasDesdeUltima != null && diasDesdeUltima > DIAS_UMBRAL_SEGUIMIENTO
  return { vencido, nunca: false, ultimaFecha, diasDesdeUltima }
}

// Texto corto y humano para mostrar en un chip/aviso, según el estado.
export function textoSeguimientoNna(estado: EstadoSeguimientoNna): string {
  if (estado.nunca) return 'Sin entrevista al NNA registrada'
  if (estado.vencido) {
    const meses = Math.round((estado.diasDesdeUltima ?? 0) / 30)
    return meses >= 2
      ? `Sin ver al NNA hace ${meses} meses`
      : `Sin ver al NNA hace ${estado.diasDesdeUltima} días`
  }
  return `Última entrevista al NNA hace ${estado.diasDesdeUltima} días`
}

// Agrupa una lista plana de gestiones (traídas en bloque para todas las causas) por
// causa_id, quedándose solo con lo que necesita este módulo (tipo + fecha). Útil en el
// Dashboard para evaluar el seguimiento de todas las causas con una sola consulta.
export function agruparGestionesPorCausa(
  gestiones: readonly { causa_id: string; tipo: string | null; fecha: string | null }[],
): Map<string, GestionSeguimiento[]> {
  const mapa = new Map<string, GestionSeguimiento[]>()
  for (const g of gestiones) {
    if (!g.causa_id) continue
    const lista = mapa.get(g.causa_id)
    const item: GestionSeguimiento = { tipo: g.tipo, fecha: g.fecha }
    if (lista) lista.push(item)
    else mapa.set(g.causa_id, [item])
  }
  return mapa
}
