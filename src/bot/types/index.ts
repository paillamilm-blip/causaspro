// ============================================================
// CAUSASPRO BOT - Types
// ============================================================

/** Credenciales para login en OJV */
export interface OJVCredentials {
  rut: string        // RUT del usuario (formato: 12345678-9)
  password: string   // Contraseña del portal PJUD
}

/** Resultado del login */
export interface LoginResult {
  success: boolean
  sessionId?: string
  error?: string
}

/** Causa a buscar */
export interface CausaToScrape {
  id: string         // UUID en Supabase
  rit: string        // RIT de la causa (ej: "P-123-2024")
  tribunal?: string  // Nombre del tribunal (opcional para filtrar)
}

/** Movimiento extraído del portal */
export interface MovimientoPJUD {
  fecha: string            // ISO date string
  etapa?: string           // Etapa procesal
  tramite: string          // Descripción del trámite/movimiento
  descripcion?: string     // Detalle adicional
  es_traslado_curador: boolean  // Detecta "TRASLADO AL CURADOR"
}

/** Audiencia extraída del portal */
export interface AudienciaPJUD {
  fecha: string            // ISO datetime string
  tipo: string             // Tipo de audiencia
  sala?: string            // Sala del tribunal
  estado?: string          // Estado (Programada, Realizada, Suspendida)
  resultado?: string       // Resultado si ya se realizó
}

/** Resolución extraída */
export interface ResolucionPJUD {
  fecha: string
  tipo: string             // Tipo de resolución
  texto_resumen?: string   // Resumen del contenido
}

/** Datos completos extraídos de una causa */
export interface CausaScrapedData {
  rit: string
  causa_id: string          // UUID de Supabase
  estado_actual?: string
  etapa_actual?: string
  tribunal?: string
  juez?: string
  movimientos: MovimientoPJUD[]
  audiencias: AudienciaPJUD[]
  resoluciones: ResolucionPJUD[]
  tiene_traslado_curador: boolean
  fecha_scraping: string    // Cuando se hizo el scraping
  error?: string            // Si hubo error al scrapear
}

/**
 * Etapa del flujo del bot. Sirve para saber DÓNDE ocurre cada cosa
 * (métricas y errores) y así "aprender" en qué paso falla más.
 */
export type BotStep =
  | 'login'
  | 'navegacion'
  | 'busqueda'
  | 'detalle'
  | 'scrape'
  | 'logout'
  | 'critico'

/**
 * Tipo de error categorizado (no texto libre). Permite AGRUPAR fallos
 * y que el motor de aprendizaje detecte patrones. Ver schema-bot-aprendizaje.sql.
 */
export type BotErrorType =
  | 'timeout'
  | 'no_encontrada'
  | 'navegacion'
  | 'parseo'
  | 'captcha'
  | 'sesion'
  | 'desconocido'

/** Estado de ejecución del bot */
export interface BotRunStatus {
  run_id: string
  started_at: string
  finished_at?: string
  total_causas: number
  procesadas: number
  exitosas: number
  fallidas: number
  detenido_por?: 'completado' | 'limite_sesion' | 'error_critico' | 'captcha' | 'bloqueado'
  errores: string[]
  // --- Métricas de auto-aprendizaje (modo conservador: solo se registran) ---
  /** Duración total de la sesión en ms (finished - started) */
  duracion_ms?: number
  /** Velocidad: causas exitosas por minuto */
  causas_por_min?: number
  /** Tasa de éxito 0-100 (exitosas / procesadas) */
  tasa_exito?: number
  /** Modo usado ('rit' | 'listado' | 'fix_letras'). fix_letras = mantenimiento de letra/tipo. */
  search_mode?: string
  /** Si se detectó una señal de bloqueo/CAPTCHA durante la sesión */
  bloqueo_detectado?: boolean
  /**
   * Causas procesadas en modo SOLO DIAGNÓSTICO (BOT_RIT con id temporal, no en la BD):
   * se scrapean/diagnostican pero NO se persisten. No cuentan como exitosas para no
   * reportar un falso éxito. 0/undefined en corridas normales.
   */
  solo_diagnostico?: number
}

/** Métrica de una etapa del flujo (una fila en bot_step_metrics) */
export interface BotStepMetric {
  run_id: string
  rit?: string
  paso: BotStep
  duracion_ms: number
  exito: boolean
  tipo_error?: BotErrorType
}

/** Configuración del bot */
export interface BotConfig {
  /** Máximo de causas por sesión (anti-detección) */
  maxCausasPorSesion: number
  /** Máximo de detalles a scrapear por sesión */
  maxDetailsPorSesion: number
  /** Delay mínimo entre consultas (ms) */
  delayMin: number
  /** Delay máximo entre consultas (ms) */
  delayMax: number
  /** Delay adicional después de login (ms) */
  delayPostLogin: number
  /** Timeout para navegación de página (ms) */
  navigationTimeout: number
  /** Timeout para selectores (ms) */
  selectorTimeout: number
  /** Si true, toma screenshots en caso de error */
  screenshotOnError: boolean
  /** Si true, ejecuta en modo headless */
  headless: boolean
  /** User agent a usar */
  userAgent: string
  /** Viewport size */
  viewport: { width: number; height: number }
  /** Priorizar causas por nivel_urgencia */
  priorizarUrgentes: boolean
  /** Años a buscar en el portal */
  years: string[]
}

/** Resultado de una sesión de scraping */
export interface ScrapeSessionResult {
  status: BotRunStatus
  data: CausaScrapedData[]
}

/** Tabla de movimientos en Supabase */
export interface MovimientoRecord {
  causa_id: string
  fecha: string
  etapa?: string
  tramite: string
  descripcion?: string
  es_traslado_curador: boolean
  fuente: 'pjud_bot'
}
