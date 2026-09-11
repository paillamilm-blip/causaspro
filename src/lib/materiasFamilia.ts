// ============================================================
// CAUSASPRO - Catálogo de Materias de Tribunales de Familia (Chile)
// ============================================================
//
// FUENTE ÚNICA DE VERDAD de qué significa cada letra (prefijo) del RIT en los
// Tribunales de Familia y a qué GRUPO práctico pertenece. Este catálogo lo usan:
//   - el parser de Excel (src/lib/parseExcel.ts) para validar/derivar el tipo,
//   - el bot (espejado en src/bot/utils/index.ts TIPOS_RIT_VALIDOS),
//   - la UI (Dashboard y detalle de causa) para mostrar materia + grupo legibles.
//
// SEGMENTACIÓN PRÁCTICA (por grupo):
//   • Contenciosos:   C (contencioso: alimentos, cuidado personal, RDR) y F (VIF).
//   • Protección NNA: P (medida de protección) y X (cumplimiento/ejecución de medida).
//   • Voluntarios:    V (gestión voluntaria) y A (adopción / susceptibilidad).
//   • Sin materia confirmada: Z (aparece en familia, materia no determinable con certeza).
//   • Genéricos/otros: T, FA, RIT (comodines que el portal puede usar).
//
// IMPORTANTE: si se agrega una letra aquí, hay que ampliar también:
//   - el CHECK constraint causas_tipo_check en la BD (ver schema-tipo-fix.sql),
//   - TIPOS_RIT_VALIDOS en src/bot/utils/index.ts.
// De lo contrario, escribir ese tipo en `causas.tipo` violaría el constraint y la
// fila se descartaría en silencio.
// ============================================================

/** Grupo práctico de la causa (para segmentar y colorear en la UI). */
export type GrupoMateria =
  | 'contencioso'
  | 'proteccion'
  | 'voluntario'
  | 'sin_materia'
  | 'generico'

export interface Materia {
  /** Letra/prefijo del RIT (mayúsculas). */
  letra: string
  /** Nombre corto de la materia (para chips/badges). */
  materia: string
  /** Descripción legible de qué abarca esa letra. */
  descripcion: string
  /** Grupo práctico al que pertenece. */
  grupo: GrupoMateria
}

/**
 * Catálogo por letra. Las materias P/X/C/F/V/A/Z están confirmadas contra fuentes
 * reales del PJUD; T/FA/RIT son comodines genéricos que el sistema tolera pero cuya
 * materia específica no está fijada.
 */
export const MATERIAS_FAMILIA: Record<string, Materia> = {
  // --- Procedimientos contenciosos -----------------------------------------
  C: {
    letra: 'C',
    materia: 'Contencioso',
    descripcion:
      'Causa contenciosa de familia (p. ej. alimentos, cuidado personal, relación directa y regular).',
    grupo: 'contencioso',
  },
  F: {
    letra: 'F',
    materia: 'Violencia intrafamiliar',
    descripcion: 'Actos de violencia intrafamiliar (VIF).',
    grupo: 'contencioso',
  },

  // --- Protección de niños, niñas y adolescentes ---------------------------
  P: {
    letra: 'P',
    materia: 'Protección',
    descripcion: 'Causa de protección o medidas de protección de un NNA.',
    grupo: 'proteccion',
  },
  X: {
    letra: 'X',
    materia: 'Cumplimiento de protección',
    descripcion: 'Cumplimiento o ejecución de una medida de protección.',
    grupo: 'proteccion',
  },

  // --- Procedimientos voluntarios o especiales -----------------------------
  V: {
    letra: 'V',
    materia: 'Gestión voluntaria',
    descripcion: 'Gestión judicial voluntaria.',
    grupo: 'voluntario',
  },
  A: {
    letra: 'A',
    materia: 'Adopción',
    descripcion: 'Adopción o susceptibilidad de adopción.',
    grupo: 'voluntario',
  },

  // --- Código identificado, sin materia confirmada -------------------------
  Z: {
    letra: 'Z',
    materia: 'Sin materia confirmada',
    descripcion:
      'Aparece en causas de familia, pero la fuente disponible no permite determinar con certeza su materia específica.',
    grupo: 'sin_materia',
  },

  // --- Genéricos / comodines del portal ------------------------------------
  T: {
    letra: 'T',
    materia: 'Tutela / genérico',
    descripcion: 'Prefijo genérico (tutela u otros). Materia específica no fijada.',
    grupo: 'generico',
  },
  FA: {
    letra: 'FA',
    materia: 'Familia (multi-letra)',
    descripcion: 'Prefijo multi-letra usado por el portal. Materia específica no fijada.',
    grupo: 'generico',
  },
  RIT: {
    letra: 'RIT',
    materia: 'RIT genérico',
    descripcion: 'Prefijo genérico. Materia específica no fijada.',
    grupo: 'generico',
  },
}

/**
 * Lista de letras VÁLIDAS para la columna `causas.tipo`. Derivada del catálogo,
 * de modo que catálogo y whitelist NUNCA se desincronicen.
 * DEBE coincidir con el CHECK constraint causas_tipo_check en la BD y con
 * TIPOS_RIT_VALIDOS del bot.
 */
export const LETRAS_VALIDAS: string[] = Object.keys(MATERIAS_FAMILIA)

/** Etiqueta legible de cada grupo, para encabezados y filtros en la UI. */
export const GRUPO_LABEL: Record<GrupoMateria, string> = {
  contencioso: 'Contenciosos',
  proteccion: 'Protección NNA',
  voluntario: 'Voluntarios / especiales',
  sin_materia: 'Sin materia confirmada',
  generico: 'Genéricos',
}

/**
 * Devuelve la Materia asociada a un `tipo`/letra (case-insensitive).
 * Retorna undefined si la letra no está en el catálogo (o si es null/undefined).
 */
export function materiaDeTipo(tipo?: string | null): Materia | undefined {
  if (!tipo) return undefined
  return MATERIAS_FAMILIA[tipo.trim().toUpperCase()]
}

/**
 * Extrae la letra/prefijo de un RIT ya canónico ("P-4596-2024" → "P",
 * "FA-12-2024" → "FA") y devuelve su Materia si está en el catálogo.
 * NUNCA inventa: si el RIT no trae letra reconocida, retorna undefined.
 */
export function materiaDeRit(rit?: string | null): Materia | undefined {
  if (!rit) return undefined
  const m = rit.trim().toUpperCase().match(/^([A-Z]{1,3})-\d/)
  if (!m) return undefined
  return MATERIAS_FAMILIA[m[1]]
}
