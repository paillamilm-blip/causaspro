// ============================================================
// CAUSASPRO EMAIL INTERCEPTOR - Types
// ============================================================

/** Configuración de conexión IMAP */
export interface ImapConfig {
  host: string          // Servidor IMAP (ej: mail.cajmetro.cl)
  port: number          // Puerto (993 para SSL, 143 para STARTTLS)
  secure: boolean       // true para SSL/TLS
  user: string          // Email completo (pvargas@cajmetro.cl)
  password: string      // Contraseña del correo
}

/** Email parseado */
export interface ParsedEmail {
  id: string            // Message-ID o UID
  from: string          // Remitente
  subject: string       // Asunto
  date: string          // Fecha ISO
  html: string          // Contenido HTML
  text?: string         // Contenido texto plano
}

// Estos dos tipos se MOVIERON a src/lib/ junto con el parser y el guardado (ver la nota
// en src/lib/asignacionesParser.ts). Se re-exportan con el nombre viejo para no romper a
// quien los importe desde acá, pero la definición vive en un solo lugar: así no pueden
// quedar desincronizados.

/** Asignación extraída de la tabla del correo. Definida en src/lib/asignacionesParser.ts */
export type { Asignacion as AsignacionEmail } from '../../lib/asignacionesParser'

/** Resultado de procesar las asignaciones. Definido en src/lib/asignacionesSync.ts */
export type { ResultadoSync as EmailProcessResult } from '../../lib/asignacionesSync'

/** Estado de una ejecución del interceptor */
export interface EmailRunStatus {
  run_id: string
  started_at: string
  finished_at?: string
  emails_revisados: number
  emails_procesados: number
  asignaciones_total: number
  causas_creadas: number
  errores: string[]
}
