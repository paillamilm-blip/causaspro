// ============================================================
// CAUSASPRO - Copiloto de Decisiones (motor heuristico)
// Traduce el "legales" del PJUD a: que decidir, cuando y con que riesgo.
// Funciones PURAS: sin red, sin IA, siempre disponibles y testeables.
// El motor IA (aiClient.ts) es opcional y solo ENRIQUECE lo que sale de aqui.
// ============================================================

export type Prioridad = 'critico' | 'importante' | 'oportunidad' | 'informativo'

export interface Decision {
  /** Titulo corto de la decision, ej: "Te dieron traslado" */
  titulo: string
  /** Que significa en lenguaje simple */
  explicacion: string
  /** Accion concreta sugerida, ej: "Contestar el traslado" */
  accion: string
  /** Riesgo si no se actua */
  riesgo: string
  /** Prioridad para ordenar las tarjetas */
  prioridad: Prioridad
  /** Plazo en dias habiles (si aplica) */
  plazoDiasHabiles: number | null
  /** Fecha limite calculada (ISO 'YYYY-MM-DD') si hay plazo */
  fechaLimite: string | null
  /** true si el plazo es fatal / preclusivo */
  esFatal: boolean
  /** Etiqueta del tipo de movimiento detectado */
  categoria: string
  /** De donde salio: 'heuristico' | 'ia' */
  fuente: 'heuristico' | 'ia'
}

/** Movimiento minimo que el copiloto necesita interpretar. */
export interface MovimientoInput {
  tramite: string
  descripcion?: string | null
  etapa?: string | null
  fecha?: string | null // fecha del movimiento (ISO)
}

// ============================================================
// FERIADOS LEGALES CHILE (solo fecha FIJA) — para el calculo de dias habiles.
// APROXIMACION: los feriados MOVILES se omiten a proposito:
//   - Semana Santa (viernes y sabado santo)
//   - Dia de los Pueblos Indigenas (sigue el solsticio de invierno, ~20/21 jun)
//   - San Pedro y San Pablo, Encuentro de dos mundos, Iglesias evangelicas
//     (se trasladan de lunes segun la Ley 19.668)
// Consecuencia: un plazo que cruza un feriado movil puede quedar calculado UN
// dia habil ANTES de lo real. Erra hacia actuar antes (lado seguro), pero la
// fecha limite debe presentarse como REFERENCIAL, no como calculo exacto.
// Formato MM-DD.
// ============================================================
const FERIADOS_FIJOS_CL = new Set([
  '01-01', // Ano nuevo
  '05-01', // Dia del trabajador
  '05-21', // Dia de las glorias navales
  '07-16', // Virgen del Carmen
  '08-15', // Asuncion de la Virgen
  '09-18', // Independencia
  '09-19', // Glorias del Ejercito
  '11-01', // Todos los santos
  '12-08', // Inmaculada Concepcion
  '12-25', // Navidad
])

function esDiaHabil(d: Date): boolean {
  const dow = d.getDay() // 0=domingo, 6=sabado
  if (dow === 0 || dow === 6) return false
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return !FERIADOS_FIJOS_CL.has(mmdd)
}

function parseFecha(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Suma N dias habiles a una fecha (excluye fin de semana y feriados fijos).
 * @param desde fecha base (default: hoy)
 */
export function sumarDiasHabiles(dias: number, desde?: Date): string {
  const d = desde ? new Date(desde) : new Date()
  d.setHours(0, 0, 0, 0)
  let contados = 0
  while (contados < dias) {
    d.setDate(d.getDate() + 1)
    if (esDiaHabil(d)) contados++
  }
  return fmt(d)
}

/** Dias habiles restantes entre hoy y una fecha limite (puede ser negativo si ya paso). */
export function diasHabilesHasta(fechaLimite: string): number {
  const limite = parseFecha(fechaLimite)
  if (!limite) return 0
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  limite.setHours(0, 0, 0, 0)

  if (limite.getTime() === hoy.getTime()) return 0
  const adelante = limite > hoy
  const paso = adelante ? 1 : -1
  const cursor = new Date(hoy)
  let habiles = 0
  while (cursor.getTime() !== limite.getTime()) {
    cursor.setDate(cursor.getDate() + paso)
    if (esDiaHabil(cursor)) habiles += paso
  }
  return habiles
}

// ============================================================
// CATALOGO DE PATRONES DEL PJUD
// Cada regla detecta un tipo de movimiento y define la decision.
// El orden importa: la primera que matchea gana.
// ============================================================
interface Regla {
  categoria: string
  // patrones (mayusculas) que deben aparecer en el texto del movimiento
  patrones: string[]
  prioridadBase: Prioridad
  plazoDiasHabiles: number | null
  esFatal: boolean
  construir: (m: MovimientoInput) => Omit<Decision, 'prioridad' | 'plazoDiasHabiles' | 'fechaLimite' | 'esFatal' | 'categoria' | 'fuente'>
}

// IMPORTANTE: el orden importa. Las reglas ESPECIFICAS van ANTES que las
// genericas, porque la primera que matchea gana. Ej: "traslado de la demanda"
// (plazo 15) debe evaluarse antes que "traslado" a secas (plazo 5).
const REGLAS: Regla[] = [
  {
    categoria: 'demanda_notificada',
    patrones: ['CONFIERE TRASLADO DE LA DEMANDA', 'NOTIFICA DEMANDA', 'TRASLADO DE LA DEMANDA'],
    prioridadBase: 'critico',
    plazoDiasHabiles: 15,
    esFatal: true,
    construir: () => ({
      titulo: 'Demanda notificada',
      explicacion: 'Fuiste notificado de una demanda. Corre el plazo para contestar.',
      accion: 'Preparar y presentar la contestacion de la demanda',
      riesgo: 'Si no contestas, se te puede tener por rebelde y seguir el juicio sin ti.',
    }),
  },
  {
    categoria: 'traslado',
    patrones: ['TRASLADO'],
    prioridadBase: 'critico',
    plazoDiasHabiles: 5,
    esFatal: true,
    construir: () => ({
      titulo: 'Te confirieron traslado',
      explicacion: 'El tribunal te dio traslado: debes pronunciarte sobre lo presentado por la contraparte.',
      accion: 'Redactar y presentar la contestacion del traslado',
      riesgo: 'Si no respondes dentro del plazo, precluye tu derecho a hacerlo (lo pierdes).',
    }),
  },
  {
    categoria: 'apercibimiento',
    patrones: ['APERCIBIMIENTO', 'BAJO APERCIBIMIENTO'],
    prioridadBase: 'critico',
    plazoDiasHabiles: 5,
    esFatal: true,
    construir: () => ({
      titulo: 'Resolucion bajo apercibimiento',
      explicacion: 'El tribunal exige una actuacion advirtiendo una consecuencia si no la cumples.',
      accion: 'Cumplir lo ordenado antes del plazo',
      riesgo: 'Se aplicara el apercibimiento (multa, tener por no presentado, etc.).',
    }),
  },
  {
    categoria: 'plazo_fatal',
    patrones: ['PLAZO FATAL', 'ULTIMO PLAZO'],
    prioridadBase: 'critico',
    plazoDiasHabiles: 3,
    esFatal: true,
    construir: () => ({
      titulo: 'Plazo fatal en curso',
      explicacion: 'Hay un plazo fatal: vence indefectiblemente por el solo transcurso del tiempo.',
      accion: 'Realizar la actuacion pendiente de inmediato',
      riesgo: 'El derecho se extingue al vencer el plazo, sin posibilidad de recuperarlo.',
    }),
  },
  {
    categoria: 'audiencia',
    patrones: ['AUDIENCIA', 'COMPARENDO'],
    prioridadBase: 'importante',
    plazoDiasHabiles: null,
    esFatal: false,
    construir: () => ({
      titulo: 'Audiencia fijada',
      explicacion: 'Se cito a una audiencia. Debes preparar tu intervencion y la prueba.',
      accion: 'Preparar la audiencia (prueba, testigos, minuta)',
      riesgo: 'No comparecer puede significar rebeldia o perder la instancia.',
    }),
  },
  {
    categoria: 'rebeldia_contraparte',
    patrones: ['ACUSA REBELDIA', 'EN REBELDIA', 'REBELDIA'],
    prioridadBase: 'oportunidad',
    plazoDiasHabiles: null,
    esFatal: false,
    construir: () => ({
      titulo: 'Posible rebeldia de la contraparte',
      explicacion: 'La contraparte no actuo en su plazo. Puedes impulsar el proceso a tu favor.',
      accion: 'Evaluar acusar la rebeldia y pedir se tenga por evacuado el tramite',
      riesgo: 'Oportunidad procesal: no aprovecharla solo demora tu causa.',
    }),
  },
  {
    categoria: 'resolucion_generica',
    patrones: ['RESOLUCION', 'RESUELVE', 'PROVEIDO', 'DECRETO'],
    prioridadBase: 'importante',
    plazoDiasHabiles: null,
    esFatal: false,
    construir: (m) => ({
      titulo: 'Nueva resolucion',
      explicacion: `El tribunal dicto una resolucion: "${(m.tramite || '').slice(0, 80)}".`,
      accion: 'Revisar la resolucion y definir si requiere una actuacion',
      riesgo: 'Podria contener un plazo o carga procesal. Conviene revisarla.',
    }),
  },
]

/**
 * Interpreta UN movimiento del PJUD y devuelve la decision (heuristica).
 * @param m movimiento
 * @param baseFecha fecha desde la que contar el plazo (default: la fecha del movimiento o hoy)
 */
export function interpretarMovimiento(m: MovimientoInput, baseFecha?: Date): Decision {
  const texto = `${m.tramite || ''} ${m.descripcion || ''} ${m.etapa || ''}`.toUpperCase()

  // Buscar la primera regla que matchee
  const regla =
    REGLAS.find((r) => r.patrones.some((p) => texto.includes(p))) || null

  const base = baseFecha || parseFecha(m.fecha) || new Date()

  if (!regla) {
    return {
      titulo: 'Movimiento nuevo',
      explicacion: `Se registro: "${(m.tramite || 'sin detalle').slice(0, 100)}".`,
      accion: 'Revisar el movimiento en el expediente',
      riesgo: 'Sin patron de urgencia detectado.',
      prioridad: 'informativo',
      plazoDiasHabiles: null,
      fechaLimite: null,
      esFatal: false,
      categoria: 'otro',
      fuente: 'heuristico',
    }
  }

  const parcial = regla.construir(m)
  const fechaLimite = regla.plazoDiasHabiles != null ? sumarDiasHabiles(regla.plazoDiasHabiles, base) : null

  // Escalar prioridad si el plazo esta muy cerca o ya vencio
  let prioridad = regla.prioridadBase
  if (fechaLimite) {
    const restan = diasHabilesHasta(fechaLimite)
    if (restan <= 2) prioridad = 'critico'
  }

  return {
    ...parcial,
    prioridad,
    plazoDiasHabiles: regla.plazoDiasHabiles,
    fechaLimite,
    esFatal: regla.esFatal,
    categoria: regla.categoria,
    fuente: 'heuristico',
  }
}

/** Peso numerico de prioridad para ordenar (menor = mas urgente). */
export function pesoPrioridad(p: Prioridad): number {
  switch (p) {
    case 'critico':
      return 0
    case 'importante':
      return 1
    case 'oportunidad':
      return 2
    default:
      return 3
  }
}

/** Ordena decisiones por prioridad y luego por cercania del plazo. */
export function ordenarDecisiones<T extends { prioridad: Prioridad; fechaLimite: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const dp = pesoPrioridad(a.prioridad) - pesoPrioridad(b.prioridad)
    if (dp !== 0) return dp
    // ambos con plazo: el mas cercano primero
    if (a.fechaLimite && b.fechaLimite) return a.fechaLimite.localeCompare(b.fechaLimite)
    if (a.fechaLimite) return -1
    if (b.fechaLimite) return 1
    return 0
  })
}
